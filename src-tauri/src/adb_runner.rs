use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc::Receiver;
use crate::errors::AppError;

/// Low-level runner that executes the ADB sidecar with arguments.
pub struct AdbRunner;

impl AdbRunner {
    /// Executes an ADB command and waits for it to complete, returning stdout on success.
    pub async fn run(app: &AppHandle, args: &[String]) -> Result<String, AppError> {
        let sidecar = app.shell()
            .sidecar("adb")
            .map_err(|e| AppError::Unknown(format!("Sidecar initialization failed: {}", e)))?;

        let output = sidecar
            .args(args)
            .output()
            .await
            .map_err(|e| AppError::AdbError(format!("Process execution failed: {}", e)))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            
            // Check for known ADB connection states
            if stderr.contains("device offline") {
                Err(AppError::DeviceOffline)
            } else if stderr.contains("unauthorized") || stdout.contains("unauthorized") {
                Err(AppError::Unauthorized)
            } else if stderr.contains("permission denied") {
                Err(AppError::PermissionDenied)
            } else {
                Err(AppError::AdbError(if stderr.is_empty() { stdout } else { stderr }))
            }
        }
    }

    /// Spawns an ADB process asynchronously, returning a receiver for command events and the child handle.
    pub fn spawn(
        app: &AppHandle,
        args: &[String],
    ) -> Result<(Receiver<CommandEvent>, CommandChild), AppError> {
        let sidecar = app.shell()
            .sidecar("adb")
            .map_err(|e| AppError::Unknown(format!("Sidecar initialization failed: {}", e)))?;

        let (rx, child) = sidecar
            .args(args)
            .spawn()
            .map_err(|e| AppError::AdbError(format!("Failed to spawn process: {}", e)))?;

        Ok((rx, child))
    }
}
