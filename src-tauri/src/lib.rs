mod errors;
mod path_handler;
mod fs_trait;
mod adb_runner;
mod adb_service;
mod device_manager;
mod local_fs;
mod android_fs;
mod transfer_manager;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Register selected device state
            app.manage(device_manager::SelectedDeviceState::new());
            
            // Register transfer manager queue
            let manager = transfer_manager::TransferManager::new(app.handle().clone());
            app.manage(manager);
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::select_device,
            commands::get_selected_device,
            commands::read_dir,
            commands::create_dir,
            commands::rename_item,
            commands::remove_item,
            commands::start_transfer,
            commands::cancel_transfer,
            commands::connect_wireless,
            commands::disconnect_wireless,
            commands::enable_tcpip,
            commands::get_gateway_ip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
