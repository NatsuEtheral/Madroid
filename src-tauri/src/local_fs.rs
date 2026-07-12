use std::fs;
use std::os::unix::fs::PermissionsExt;
use chrono::{DateTime, Utc};
use crate::errors::AppError;
use crate::fs_trait::{FileInfo, FileSystem};

pub struct LocalFS;

impl LocalFS {
    fn format_permissions(mode: u32, is_dir: bool) -> String {
        let mut s = String::new();
        s.push(if is_dir { 'd' } else { '-' });
        
        let rwx = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
        s.push_str(rwx[((mode >> 6) & 0x7) as usize]);
        s.push_str(rwx[((mode >> 3) & 0x7) as usize]);
        s.push_str(rwx[(mode & 0x7) as usize]);
        s
    }
}

impl FileSystem for LocalFS {
    async fn read_dir(&self, path: &str) -> Result<Vec<FileInfo>, AppError> {
        let entries = fs::read_dir(path)?;
        let mut file_infos = Vec::new();

        for entry in entries {
            let entry = entry?;
            let metadata = entry.metadata()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };

            // Format modified time as ISO 8601 string
            let modified = metadata.modified()
                .ok()
                .map(|sys_time| {
                    let dt: DateTime<Utc> = sys_time.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_else(|| "".to_string());

            let mode = metadata.permissions().mode();
            let permissions = Self::format_permissions(mode, is_dir);

            file_infos.push(FileInfo {
                name,
                is_dir,
                size,
                modified,
                permissions,
            });
        }

        // Sort: directories first, then files alphabetically
        file_infos.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(file_infos)
    }

    async fn create_dir(&self, path: &str) -> Result<(), AppError> {
        fs::create_dir_all(path)?;
        Ok(())
    }

    async fn rename(&self, src: &str, dest: &str) -> Result<(), AppError> {
        fs::rename(src, dest)?;
        Ok(())
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        let metadata = fs::metadata(path)?;
        if metadata.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}
