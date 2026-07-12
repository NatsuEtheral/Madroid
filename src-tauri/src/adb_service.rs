use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use crate::errors::AppError;
use crate::adb_runner::AdbRunner;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum ConnectionType {
    USB,
    Wireless,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub android_version: String,
    pub authorized: bool,
    pub connection_type: ConnectionType,
}

pub struct AdbService;

impl AdbService {
    /// Lists all currently connected devices by parsing `adb devices -l`.
    pub async fn list_devices(app: &AppHandle) -> Result<Vec<Device>, AppError> {
        let output = AdbRunner::run(app, &["devices".to_string(), "-l".to_string()]).await?;
        let mut devices = Vec::new();
        
        let lines: Vec<&str> = output.lines().collect();
        if lines.is_empty() {
            return Ok(devices);
        }

        // The first line is "List of devices attached"
        for line in lines.iter().skip(1) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }

            let serial = parts[0].to_string();
            let state = parts[1];
            
            let authorized = state == "device";
            
            let connection_type = if serial.contains(':') {
                ConnectionType::Wireless
            } else {
                ConnectionType::USB
            };

            let mut model = "Unknown Device".to_string();
            for part in parts.iter().skip(2) {
                if part.starts_with("model:") {
                    model = part.replace("model:", "").replace('_', " ");
                    break;
                }
            }

            let mut android_version = "Unknown".to_string();
            if authorized {
                // Fetch Android Version release
                let ver_args = vec![
                    "-s".to_string(),
                    serial.clone(),
                    "shell".to_string(),
                    "getprop ro.build.version.release".to_string(),
                ];
                if let Ok(ver_out) = AdbRunner::run(app, &ver_args).await {
                    let release = ver_out.trim();
                    if !release.is_empty() {
                        android_version = release.to_string();
                    }
                }
            }

            devices.push(Device {
                serial,
                model,
                android_version,
                authorized,
                connection_type,
            });
        }

        Ok(devices)
    }

    /// Verifies if a device supports the `stat -c` command formatting.
    pub async fn detect_stat_support(app: &AppHandle, serial: &str) -> bool {
        let test_args = vec![
            "-s".to_string(),
            serial.to_string(),
            "shell".to_string(),
            "stat -c '%F' /sdcard".to_string(),
        ];
        match AdbRunner::run(app, &test_args).await {
            Ok(output) => {
                let trimmed = output.trim();
                // If it successfully returns something containing "directory" or "file" or similar, stat works!
                !trimmed.is_empty() && !trimmed.contains("invalid option") && !trimmed.contains("not found")
            }
            Err(_) => false,
        }
    }

    /// Connects to a device wirelessly via TCP/IP.
    pub async fn connect_wireless(app: &AppHandle, ip: &str, port: u16) -> Result<(), AppError> {
        let target = format!("{}:{}", ip, port);
        let output = AdbRunner::run(app, &["connect".to_string(), target.clone()]).await?;
        if output.contains("connected to") {
            Ok(())
        } else {
            Err(AppError::AdbError(format!("Wireless connection failed: {}", output.trim())))
        }
    }

    /// Disconnects from a wireless device.
    pub async fn disconnect_wireless(app: &AppHandle, ip: &str, port: u16) -> Result<(), AppError> {
        let target = format!("{}:{}", ip, port);
        let _ = AdbRunner::run(app, &["disconnect".to_string(), target]).await?;
        Ok(())
    }

    /// Re-initializes ADB over TCP on port 5555. (Requires USB connection first).
    pub async fn enable_tcpip(app: &AppHandle, serial: &str, port: u16) -> Result<(), AppError> {
        let args = vec![
            "-s".to_string(),
            serial.to_string(),
            "tcpip".to_string(),
            port.to_string(),
        ];
        let _ = AdbRunner::run(app, &args).await?;
        Ok(())
    }
}
