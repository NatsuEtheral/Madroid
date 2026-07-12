use serde::Serialize;
use thiserror::Error;

#[derive(Serialize, Clone, Debug, Error)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    #[error("Device is offline")]
    DeviceOffline,
    #[error("Device is unauthorized. Please allow USB debugging on your device.")]
    Unauthorized,
    #[error("Permission denied")]
    PermissionDenied,
    #[error("File already exists")]
    FileAlreadyExists,
    #[error("No space left on device")]
    NoSpace,
    #[error("Invalid file path")]
    InvalidPath,
    #[error("Connection lost")]
    ConnectionLost,
    #[error("Operation cancelled")]
    Cancelled,
    #[error("ADB execution error: {0}")]
    AdbError(String),
    #[error("I/O error: {0}")]
    IoError(String),
    #[error("Unknown error: {0}")]
    Unknown(String),
}

// Allow easy conversion from std::io::Error
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::IoError(err.to_string())
    }
}
