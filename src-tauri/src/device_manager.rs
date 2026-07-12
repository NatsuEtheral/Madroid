use std::sync::Mutex;

pub struct SelectedDeviceState {
    pub serial: Mutex<Option<String>>,
    pub stat_supported: Mutex<bool>,
}

impl SelectedDeviceState {
    pub fn new() -> Self {
        Self {
            serial: Mutex::new(None),
            stat_supported: Mutex::new(false),
        }
    }

    pub fn set_device(&self, serial: Option<String>, stat: bool) {
        if let Ok(mut guard) = self.serial.lock() {
            *guard = serial;
        }
        if let Ok(mut guard) = self.stat_supported.lock() {
            *guard = stat;
        }
    }

    pub fn get_serial(&self) -> Option<String> {
        self.serial.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn is_stat_supported(&self) -> bool {
        self.stat_supported.lock().ok().map(|guard| *guard).unwrap_or(false)
    }
}
