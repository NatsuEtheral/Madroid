use serde::{Deserialize, Serialize};
use crate::errors::AppError;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileInfo {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String, // ISO timestamp or epoch
    pub permissions: String, // e.g. "drwxrwxrwx"
}

pub trait FileSystem: Send + Sync {
    /// Read contents of a directory and return a list of files.
    fn read_dir(&self, path: &str) -> impl std::future::Future<Output = Result<Vec<FileInfo>, AppError>> + Send;

    /// Create a directory.
    fn create_dir(&self, path: &str) -> impl std::future::Future<Output = Result<(), AppError>> + Send;

    /// Rename or move a file/directory.
    fn rename(&self, src: &str, dest: &str) -> impl std::future::Future<Output = Result<(), AppError>> + Send;

    /// Remove a file or directory.
    fn remove(&self, path: &str) -> impl std::future::Future<Output = Result<(), AppError>> + Send;
}
