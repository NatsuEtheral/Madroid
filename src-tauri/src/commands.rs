use std::sync::Arc;
use tauri::{AppHandle, State};
use uuid::Uuid;
use crate::errors::AppError;
use crate::fs_trait::{FileInfo, FileSystem};
use crate::local_fs::LocalFS;
use crate::android_fs::AndroidFS;
use crate::adb_service::{AdbService, Device};
use crate::device_manager::SelectedDeviceState;
use crate::transfer_manager::{TransferManager, TransferDirection};

#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Result<Vec<Device>, AppError> {
    AdbService::list_devices(&app).await
}

#[tauri::command]
pub async fn select_device(
    app: AppHandle,
    state: State<'_, SelectedDeviceState>,
    serial: String,
) -> Result<(), AppError> {
    let stat_supported = AdbService::detect_stat_support(&app, &serial).await;
    state.set_device(Some(serial), stat_supported);
    Ok(())
}

#[tauri::command]
pub async fn get_selected_device(state: State<'_, SelectedDeviceState>) -> Result<Option<String>, AppError> {
    Ok(state.get_serial())
}

#[tauri::command]
pub async fn read_dir(
    app: AppHandle,
    state: State<'_, SelectedDeviceState>,
    path: String,
    is_local: bool,
) -> Result<Vec<FileInfo>, AppError> {
    if is_local {
        let fs = LocalFS;
        fs.read_dir(&path).await
    } else {
        let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
        let stat = state.is_stat_supported();
        let fs = AndroidFS::new(app, serial, stat);
        fs.read_dir(&path).await
    }
}

#[tauri::command]
pub async fn create_dir(
    app: AppHandle,
    state: State<'_, SelectedDeviceState>,
    path: String,
    is_local: bool,
) -> Result<(), AppError> {
    if is_local {
        let fs = LocalFS;
        fs.create_dir(&path).await
    } else {
        let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
        let stat = state.is_stat_supported();
        let fs = AndroidFS::new(app, serial, stat);
        fs.create_dir(&path).await
    }
}

#[tauri::command]
pub async fn rename_item(
    app: AppHandle,
    state: State<'_, SelectedDeviceState>,
    src: String,
    dest: String,
    is_local: bool,
) -> Result<(), AppError> {
    if is_local {
        let fs = LocalFS;
        fs.rename(&src, &dest).await
    } else {
        let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
        let stat = state.is_stat_supported();
        let fs = AndroidFS::new(app, serial, stat);
        fs.rename(&src, &dest).await
    }
}

#[tauri::command]
pub async fn remove_item(
    app: AppHandle,
    state: State<'_, SelectedDeviceState>,
    path: String,
    is_local: bool,
) -> Result<(), AppError> {
    if is_local {
        let fs = LocalFS;
        fs.remove(&path).await
    } else {
        let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
        let stat = state.is_stat_supported();
        let fs = AndroidFS::new(app, serial, stat);
        fs.remove(&path).await
    }
}

#[tauri::command]
pub async fn start_transfer(
    state: State<'_, SelectedDeviceState>,
    manager: State<'_, Arc<TransferManager>>,
    src: String,
    dest: String,
    direction: String,
) -> Result<String, AppError> {
    let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
    let dir = match direction.as_str() {
        "push" => TransferDirection::Push,
        "pull" => TransferDirection::Pull,
        _ => return Err(AppError::InvalidPath),
    };
    let task_id = manager.add_transfer(&src, &dest, dir, &serial).await?;
    Ok(task_id.to_string())
}

#[tauri::command]
pub async fn cancel_transfer(
    state: State<'_, SelectedDeviceState>,
    manager: State<'_, Arc<TransferManager>>,
    task_id: String,
) -> Result<(), AppError> {
    let serial = state.get_serial().ok_or(AppError::DeviceOffline)?;
    let uuid = Uuid::parse_str(&task_id).map_err(|_| AppError::InvalidPath)?;
    manager.cancel_transfer(uuid, &serial).await
}

#[tauri::command]
pub async fn connect_wireless(app: AppHandle, ip: String, port: u16) -> Result<(), AppError> {
    AdbService::connect_wireless(&app, &ip, port).await
}

#[tauri::command]
pub async fn disconnect_wireless(app: AppHandle, ip: String, port: u16) -> Result<(), AppError> {
    AdbService::disconnect_wireless(&app, &ip, port).await
}

#[tauri::command]
pub async fn enable_tcpip(app: AppHandle, serial: String, port: u16) -> Result<(), AppError> {
    AdbService::enable_tcpip(&app, &serial, port).await
}

#[tauri::command]
pub async fn get_gateway_ip() -> Result<String, AppError> {
    let output = std::process::Command::new("ipconfig")
        .args(&["getoption", "en0", "router"])
        .output()
        .map_err(|e| AppError::Unknown(format!("Failed to query ipconfig: {}", e)))?;
    
    if output.status.success() {
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ip.is_empty() {
            return Ok(ip);
        }
    }
    
    // Default fallback gateway common on Android hotspots
    Ok("192.168.43.1".to_string())
}
