use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, Semaphore, mpsc};
use uuid::Uuid;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::errors::AppError;
use crate::adb_runner::AdbRunner;
use crate::path_handler::quote_remote_path;

#[derive(serde::Serialize, Clone, Debug)]
pub enum TransferDirection {
    Push, // Mac -> Android
    Pull, // Android -> Mac
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(tag = "status", content = "payload")]
pub enum TransferState {
    Queued,
    Preparing,
    Running {
        bytes_transferred: u64,
        total_bytes: u64,
        speed_bps: f64,
        eta_seconds: f64,
        percentage: f32,
    },
    Verifying,
    Completed,
    Failed(AppError),
    Cancelled,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct TransferTask {
    pub id: Uuid,
    pub src_path: String,
    pub dest_path: String,
    pub direction: TransferDirection,
    pub total_bytes: u64,
    pub state: TransferState,
}

pub struct TransferManager {
    pub app: AppHandle,
    pub tasks: Arc<Mutex<HashMap<Uuid, TransferTask>>>,
    pub active_processes: Arc<Mutex<HashMap<Uuid, CommandChild>>>,
    pub queue_tx: mpsc::Sender<Uuid>,
    pub semaphore: Arc<Semaphore>,
}

impl TransferManager {
    /// Creates a new TransferManager instance and starts the background queue processor.
    pub fn new(app: AppHandle) -> Arc<Self> {
        let (queue_tx, mut queue_rx) = mpsc::channel::<Uuid>(100);
        let tasks = Arc::new(Mutex::new(HashMap::new()));
        let active_processes = Arc::new(Mutex::new(HashMap::new()));
        let semaphore = Arc::new(Semaphore::new(2)); // Max 2 concurrent transfers

        let manager = Arc::new(Self {
            app: app.clone(),
            tasks: tasks.clone(),
            active_processes: active_processes.clone(),
            queue_tx,
            semaphore: semaphore.clone(),
        });

        // Spawn background queue scheduler loop
        let manager_clone = manager.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(task_id) = queue_rx.recv().await {
                let manager = manager_clone.clone();
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                
                tauri::async_runtime::spawn(async move {
                    let _permit = permit; // Holds lock during execution
                    manager.run_transfer(task_id).await;
                });
            }
        });

        manager
    }

    /// Enqueues a file transfer task.
    pub async fn add_transfer(
        &self,
        src: &str,
        dest: &str,
        direction: TransferDirection,
        serial: &str,
    ) -> Result<Uuid, AppError> {
        let task_id = Uuid::new_v4();
        
        // Retrieve file size before starting
        let total_bytes = match direction {
            TransferDirection::Push => {
                std::fs::metadata(src)?.len()
            }
            TransferDirection::Pull => {
                // Fetch remote size using stat or default to 0
                let args = vec![
                    "-s".to_string(),
                    serial.to_string(),
                    "shell".to_string(),
                    format!("stat -c '%s' {}", quote_remote_path(src)),
                ];
                match AdbRunner::run(&self.app, &args).await {
                    Ok(out) => out.trim().parse().unwrap_or(0),
                    Err(_) => 0,
                }
            }
        };

        let task = TransferTask {
            id: task_id,
            src_path: src.to_string(),
            dest_path: dest.to_string(),
            direction,
            total_bytes,
            state: TransferState::Queued,
        };

        {
            let mut lock = self.tasks.lock().await;
            lock.insert(task_id, task.clone());
        }

        self.emit_event("transfer:queued", &task);
        let _ = self.queue_tx.send(task_id).await;
        Ok(task_id)
    }

    /// Cancels an active transfer and cleans up temporary files.
    pub async fn cancel_transfer(&self, task_id: Uuid, serial: &str) -> Result<(), AppError> {
        let mut process_to_kill = None;
        let mut task_details = None;

        {
            let mut lock = self.active_processes.lock().await;
            if let Some(child) = lock.remove(&task_id) {
                process_to_kill = Some(child);
            }
        }

        {
            let mut lock = self.tasks.lock().await;
            if let Some(task) = lock.get_mut(&task_id) {
                task.state = TransferState::Cancelled;
                task_details = Some(task.clone());
            }
        }

        if let Some(child) = process_to_kill {
            let _ = child.kill();
        }

        if let Some(task) = task_details {
            self.emit_event("transfer:cancelled", &task);
            
            // Clean up partial temp files
            let tmp_dest = format!("{}.tmp", task.dest_path);
            match task.direction {
                TransferDirection::Push => {
                    // Remove remote temp file
                    let args = vec![
                        "-s".to_string(),
                        serial.to_string(),
                        "shell".to_string(),
                        format!("rm -f {}", quote_remote_path(&tmp_dest)),
                    ];
                    let _ = AdbRunner::run(&self.app, &args).await;
                }
                TransferDirection::Pull => {
                    // Remove local temp file
                    let _ = std::fs::remove_file(tmp_dest);
                }
            }
            self.app.emit("directory:updated", ()).unwrap_or(());
        }

        Ok(())
    }

    /// Internal method to run the transfer.
    async fn run_transfer(&self, task_id: Uuid) {
        let mut task = {
            let mut lock = self.tasks.lock().await;
            if let Some(t) = lock.get_mut(&task_id) {
                if let TransferState::Cancelled = t.state {
                    return; // Already cancelled
                }
                t.state = TransferState::Preparing;
                t.clone()
            } else {
                return;
            }
        };

        self.emit_event("transfer:started", &task);

        // Fetch selected device serial from global device state
        let serial_opt = self.app.state::<crate::device_manager::SelectedDeviceState>().get_serial();
        let serial = match serial_opt {
            Some(s) => s,
            None => {
                self.fail_task(task_id, AppError::DeviceOffline).await;
                return;
            }
        };

        let temp_dest = format!("{}.tmp", task.dest_path);

        // Run the appropriate command
        let args = match task.direction {
            TransferDirection::Push => {
                vec![
                    "-s".to_string(),
                    serial.clone(),
                    "push".to_string(),
                    "-p".to_string(),
                    task.src_path.clone(),
                    temp_dest.clone(),
                ]
            }
            TransferDirection::Pull => {
                vec![
                    "-s".to_string(),
                    serial.clone(),
                    "pull".to_string(),
                    "-p".to_string(),
                    task.src_path.clone(),
                    temp_dest.clone(),
                ]
            }
        };

        let (mut rx, child) = match AdbRunner::spawn(&self.app, &args) {
            Ok(res) => res,
            Err(e) => {
                self.fail_task(task_id, e).await;
                return;
            }
        };

        {
            let mut lock = self.active_processes.lock().await;
            lock.insert(task_id, child);
        }

        // Update task state to Running
        {
            let mut lock = self.tasks.lock().await;
            if let Some(t) = lock.get_mut(&task_id) {
                t.state = TransferState::Running {
                    bytes_transferred: 0,
                    total_bytes: t.total_bytes,
                    speed_bps: 0.0,
                    eta_seconds: 0.0,
                    percentage: 0.0,
                };
                task = t.clone();
            }
        }
        self.emit_event("transfer:progress", &task);

        // Spawn background file-size progress monitor polling loop
        let app_clone = self.app.clone();
        let tasks_clone = self.tasks.clone();
        let active_processes_clone = self.active_processes.clone();
        let task_id_clone = task_id;
        let temp_dest_clone = temp_dest.clone();
        let total_bytes = task.total_bytes;
        let direction = task.direction.clone();
        let serial_clone = serial.clone();

        tauri::async_runtime::spawn(async move {
            let start_time = Instant::now();
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;

                // Check if the process is still running
                let is_running = {
                    let lock = active_processes_clone.lock().await;
                    lock.contains_key(&task_id_clone)
                };
                if !is_running {
                    break;
                }

                // Check if task is still in Running state (not Completed/Failed/Cancelled)
                let is_active = {
                    let lock = tasks_clone.lock().await;
                    if let Some(t) = lock.get(&task_id_clone) {
                        matches!(t.state, TransferState::Running { .. })
                    } else {
                        false
                    }
                };
                if !is_active {
                    break;
                }

                // Query bytes written to temp file on destination
                let bytes_transferred = match direction {
                    TransferDirection::Push => {
                        let args = vec![
                            "-s".to_string(),
                            serial_clone.clone(),
                            "shell".to_string(),
                            format!("stat -c '%s' {}", quote_remote_path(&temp_dest_clone)),
                        ];
                        match AdbRunner::run(&app_clone, &args).await {
                            Ok(out) => out.trim().parse::<u64>().unwrap_or(0),
                            Err(_) => 0,
                        }
                    }
                    TransferDirection::Pull => {
                        std::fs::metadata(&temp_dest_clone)
                            .map(|m| m.len())
                            .unwrap_or(0)
                    }
                };

                if bytes_transferred > 0 && total_bytes > 0 {
                    let pct = ((bytes_transferred as f64 / total_bytes as f64) * 100.0) as f32;
                    let pct = pct.min(100.0);
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        bytes_transferred as f64 / elapsed
                    } else {
                        0.0
                    };
                    let eta = if speed > 0.0 {
                        (total_bytes.saturating_sub(bytes_transferred)) as f64 / speed
                    } else {
                        0.0
                    };

                    let updated_task = {
                        let mut lock = tasks_clone.lock().await;
                        if let Some(t) = lock.get_mut(&task_id_clone) {
                            if let TransferState::Running { .. } = t.state {
                                t.state = TransferState::Running {
                                    bytes_transferred,
                                    total_bytes,
                                    speed_bps: speed,
                                    eta_seconds: eta,
                                    percentage: pct,
                                };
                            }
                            Some(t.clone())
                        } else {
                            None
                        }
                    };

                    if let Some(t) = updated_task {
                        let _ = app_clone.emit("transfer:progress", &t);
                    }
                }
            }
        });

        let mut is_cancelled = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    let text = String::from_utf8_lossy(&chunk);
                    for line in text.split(|c| c == '\r' || c == '\n') {
                        let line = line.trim();
                        if !line.is_empty() {
                            println!("ADB STDOUT line: {}", line);
                        }
                    }
                }
                CommandEvent::Stderr(chunk) => {
                    let err = String::from_utf8_lossy(&chunk);
                    for line in err.split(|c| c == '\r' || c == '\n') {
                        let line = line.trim();
                        if !line.is_empty() {
                            println!("ADB STDERR line: {}", line);
                        }
                    }
                    if err.contains("Device offline") || err.contains("device not found") {
                        self.fail_task(task_id, AppError::ConnectionLost).await;
                        return;
                    }
                }
                CommandEvent::Terminated(payload) => {
                    // Remove from active processes
                    {
                        let mut lock = self.active_processes.lock().await;
                        lock.remove(&task_id);
                    }

                    // Check if cancelled externally
                    {
                        let lock = self.tasks.lock().await;
                        if let Some(t) = lock.get(&task_id) {
                            if let TransferState::Cancelled = t.state {
                                is_cancelled = true;
                            }
                        }
                    }

                    if is_cancelled {
                        return;
                    }

                    if payload.code.unwrap_or(-1) == 0 {
                        // Success -> rename temp file to final dest
                        task.state = TransferState::Verifying;
                        self.emit_event("transfer:progress", &task);

                        let rename_res = match task.direction {
                            TransferDirection::Push => {
                                // Rename on Android
                                let q_temp = quote_remote_path(&temp_dest);
                                let q_final = quote_remote_path(&task.dest_path);
                                let mv_args = vec![
                                    "-s".to_string(),
                                    serial.clone(),
                                    "shell".to_string(),
                                    format!("mv {} {}", q_temp, q_final),
                                ];
                                AdbRunner::run(&self.app, &mv_args).await
                            }
                            TransferDirection::Pull => {
                                // Rename on Mac
                                std::fs::rename(&temp_dest, &task.dest_path)
                                    .map(|_| "".to_string())
                                    .map_err(|e| e.into())
                            }
                        };

                        match rename_res {
                            Ok(_) => {
                                task.state = TransferState::Completed;
                                self.emit_event("transfer:finished", &task);
                                self.app.emit("directory:updated", ()).unwrap_or(());
                            }
                            Err(e) => {
                                self.fail_task(task_id, e).await;
                            }
                        }
                    } else {
                        // Subprocess failed
                        self.fail_task(task_id, AppError::AdbError("ADB process exited with error".to_string())).await;
                    }
                    return;
                }
                _ => {}
            }
        }
    }

    /// Fails a task, cleans up temp file, and emits error event.
    async fn fail_task(&self, task_id: Uuid, error: AppError) {
        let mut task_to_fail = None;

        {
            let mut lock = self.tasks.lock().await;
            if let Some(t) = lock.get_mut(&task_id) {
                t.state = TransferState::Failed(error.clone());
                task_to_fail = Some(t.clone());
            }
        }

        if let Some(task) = task_to_fail {
            self.emit_event("transfer:failed", &task);
            
            // Clean up temp files
            let tmp_dest = format!("{}.tmp", task.dest_path);
            let serial_opt = self.app.state::<crate::device_manager::SelectedDeviceState>().get_serial();
            
            if let Some(serial) = serial_opt {
                match task.direction {
                    TransferDirection::Push => {
                        let args = vec![
                            "-s".to_string(),
                            serial,
                            "shell".to_string(),
                            format!("rm -f {}", quote_remote_path(&tmp_dest)),
                        ];
                        let _ = AdbRunner::run(&self.app, &args).await;
                    }
                    TransferDirection::Pull => {
                        let _ = std::fs::remove_file(tmp_dest);
                    }
                }
            }
            self.app.emit("directory:updated", ()).unwrap_or(());
        }
    }

    fn emit_event<S: serde::Serialize>(&self, name: &str, payload: &S) {
        self.app.emit(name, payload).unwrap_or(());
    }
}
