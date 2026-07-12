use tauri::AppHandle;
use regex::Regex;
use chrono::{DateTime, Utc};
use crate::errors::AppError;
use crate::fs_trait::{FileInfo, FileSystem};
use crate::adb_runner::AdbRunner;
use crate::path_handler::quote_remote_path;

pub struct AndroidFS {
    pub app: AppHandle,
    pub serial: String,
    pub stat_supported: bool,
}

impl AndroidFS {
    /// Creates a new AndroidFS instance.
    pub fn new(app: AppHandle, serial: String, stat_supported: bool) -> Self {
        Self {
            app,
            serial,
            stat_supported,
        }
    }

    /// Parses stat command output line.
    /// Format: `File type|Size|Epoch Mod Time|Filename`
    /// Example: `directory|4096|1684930211|/sdcard/Download`
    fn parse_stat_line(&self, line: &str) -> Option<FileInfo> {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 4 {
            return None;
        }

        let file_type = parts[0];
        let size: u64 = parts[1].parse().unwrap_or(0);
        let epoch: i64 = parts[2].parse().unwrap_or(0);
        
        // The filename might contain the absolute path, we extract the basename
        let full_path = parts[3..].join("|");
        let name = full_path.split('/').last().unwrap_or(&full_path).to_string();
        if name.is_empty() || name == "." || name == ".." {
            return None;
        }

        let is_dir = file_type.contains("directory");
        
        let modified = DateTime::from_timestamp(epoch, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "".to_string());

        let permissions = if is_dir { "drwxrwxrwx".to_string() } else { "-rwxrwxrwx".to_string() };

        Some(FileInfo {
            name,
            is_dir,
            size,
            modified,
            permissions,
        })
    }

    /// Parses `ls -la` output line using Regex.
    fn parse_ls_line(&self, line: &str) -> Option<FileInfo> {
        // Pattern 1: Permissions Link Owner Group Size Date Time Name
        // Example: -rw-rw-r-- 1 root root 12345 2026-07-08 18:23 myfile.txt
        let re_date_time = Regex::new(
            r"^([bcd-lrs-xT\-]{10})\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$"
        ).unwrap();

        // Pattern 2: Month Day Year/Time format
        // Example: drwxrwxrwx 2 shell shell 4096 Jul 8 18:23 MyFolder
        let re_month_day = Regex::new(
            r"^([bcd-lrs-xT\-]{10})\s+\S+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{2}:\d{2}))\s+(.+)$"
        ).unwrap();

        if let Some(caps) = re_date_time.captures(line) {
            let permissions = caps.get(1)?.as_str().to_string();
            let size: u64 = caps.get(2)?.as_str().parse().unwrap_or(0);
            let date_str = caps.get(3)?.as_str();
            let name = caps.get(4)?.as_str().to_string();

            if name == "." || name == ".." {
                return None;
            }

            let is_dir = permissions.starts_with('d');

            // Parse date
            let modified = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%d %H:%M")
                .ok()
                .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc).to_rfc3339())
                .unwrap_or_else(|| date_str.to_string());

            return Some(FileInfo { name, is_dir, size, modified, permissions });
        }

        if let Some(caps) = re_month_day.captures(line) {
            let permissions = caps.get(1)?.as_str().to_string();
            let size: u64 = caps.get(2)?.as_str().parse().unwrap_or(0);
            let date_str = caps.get(3)?.as_str().to_string();
            let name = caps.get(4)?.as_str().to_string();

            if name == "." || name == ".." {
                return None;
            }

            let is_dir = permissions.starts_with('d');

            return Some(FileInfo {
                name,
                is_dir,
                size,
                modified: date_str, // Use raw string if complex to parse Month-Day-Year
                permissions,
            });
        }

        None
    }
}

impl FileSystem for AndroidFS {
    async fn read_dir(&self, path: &str) -> Result<Vec<FileInfo>, AppError> {
        let mut file_infos = Vec::new();

        if self.stat_supported {
            // High-performance stat provider
            let quoted = quote_remote_path(path);
            // Run cd to directory first to resolve wildcards inside it safely
            let shell_cmd = format!("cd {} && stat -c '%F|%s|%Y|%n' *", quoted);
            let args = vec![
                "-s".to_string(),
                self.serial.clone(),
                "shell".to_string(),
                shell_cmd,
            ];

            match AdbRunner::run(&self.app, &args).await {
                Ok(output) => {
                    for line in output.lines() {
                        let line = line.trim();
                        if line.is_empty() || line.contains("No such file or directory") {
                            continue;
                        }
                        if let Some(info) = self.parse_stat_line(line) {
                            file_infos.push(info);
                        }
                    }
                }
                Err(err) => {
                    // If stat errors due to empty folder or wildcard failure, return empty vector instead of crash
                    let err_str = err.to_string();
                    if err_str.contains("No such file") || err_str.contains("No match") {
                        return Ok(Vec::new());
                    }
                    return Err(err);
                }
            }
        } else {
            // Fallback ls provider
            let quoted = quote_remote_path(path);
            let shell_cmd = format!("ls -la {}", quoted);
            let args = vec![
                "-s".to_string(),
                self.serial.clone(),
                "shell".to_string(),
                shell_cmd,
            ];

            let output = AdbRunner::run(&self.app, &args).await?;
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("total ") || line.contains("No such file") {
                    continue;
                }
                if let Some(info) = self.parse_ls_line(line) {
                    file_infos.push(info);
                }
            }
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
        let quoted = quote_remote_path(path);
        let args = vec![
            "-s".to_string(),
            self.serial.clone(),
            "shell".to_string(),
            format!("mkdir -p {}", quoted),
        ];
        AdbRunner::run(&self.app, &args).await?;
        Ok(())
    }

    async fn rename(&self, src: &str, dest: &str) -> Result<(), AppError> {
        let quoted_src = quote_remote_path(src);
        let quoted_dest = quote_remote_path(dest);
        let args = vec![
            "-s".to_string(),
            self.serial.clone(),
            "shell".to_string(),
            format!("mv {} {}", quoted_src, quoted_dest),
        ];
        AdbRunner::run(&self.app, &args).await?;
        Ok(())
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        let quoted = quote_remote_path(path);
        let args = vec![
            "-s".to_string(),
            self.serial.clone(),
            "shell".to_string(),
            format!("rm -rf {}", quoted),
        ];
        AdbRunner::run(&self.app, &args).await?;
        Ok(())
    }
}
