use unicode_normalization::UnicodeNormalization;

/// Normalizes a path to Unicode NFC form (standard for Android and most filesystems).
pub fn normalize_to_nfc(path: &str) -> String {
    path.nfc().collect::<String>()
}

/// Quotes a remote path for safe execution inside an Android shell.
/// Wraps the path in single quotes and escapes any single quotes inside it.
/// Example: `my file's name.txt` becomes `'my file'\''s name.txt'`
pub fn quote_remote_path(path: &str) -> String {
    let normalized = normalize_to_nfc(path);
    // Replace ' with '\'' and wrap the entire string in single quotes
    format!("'{}'", normalized.replace("'", "'\\''"))
}

/// Escapes special shell characters in a path. Useful when single quotes can't be used.
pub fn escape_remote_path(path: &str) -> String {
    let normalized = normalize_to_nfc(path);
    let mut escaped = String::new();
    for c in normalized.chars() {
        match c {
            ' ' | '$' | '\'' | '"' | '(' | ')' | '&' | '|' | ';' | '<' | '>' | '\\' | '`' | '*' | '?' | '[' | ']' | '!' | '#' | '~' => {
                escaped.push('\\');
                escaped.push(c);
            }
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nfc_normalization() {
        // macOS NFD string (accented 'e' represented by base 'e' + combining acute accent)
        let nfd_str = "e\u{301}"; // é
        let nfc_str = normalize_to_nfc(nfd_str);
        assert_eq!(nfc_str.chars().count(), 1);
        assert_eq!(nfc_str, "\u{e9}"); // é
    }

    #[test]
    fn test_quote_remote_path() {
        assert_eq!(quote_remote_path("simple.txt"), "'simple.txt'");
        assert_eq!(quote_remote_path("file name with spaces.txt"), "'file name with spaces.txt'");
        assert_eq!(quote_remote_path("file's name.txt"), "'file'\\''s name.txt'");
    }

    #[test]
    fn test_escape_remote_path() {
        assert_eq!(escape_remote_path("hello world.txt"), "hello\\ world.txt");
        assert_eq!(escape_remote_path("file's.txt"), "file\\'s.txt");
        assert_eq!(escape_remote_path("a$b(c)&d.txt"), "a\\$b\\(c\\)\\&d.txt");
    }
}
