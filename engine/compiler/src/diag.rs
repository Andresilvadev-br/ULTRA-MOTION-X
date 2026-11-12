pub use umx_graph::{Diagnostic, Severity};

#[derive(Debug, Default, Clone)]
pub struct Diagnostics {
    items: Vec<Diagnostic>,
}

impl Diagnostics {
    pub fn error(&mut self, code: &str, path: impl Into<String>, msg: impl Into<String>) {
        self.items.push(Diagnostic::error(code, path, msg));
    }
    pub fn warning(&mut self, code: &str, path: impl Into<String>, msg: impl Into<String>) {
        self.items.push(Diagnostic::warning(code, path, msg));
    }
    pub fn info(&mut self, code: &str, path: impl Into<String>, msg: impl Into<String>) {
        self.items.push(Diagnostic {
            severity: Severity::Info,
            code: code.into(),
            path: path.into(),
            message: msg.into(),
        });
    }
    pub fn extend_prefixed(&mut self, prefix: &str, ds: Vec<Diagnostic>) {
        for mut d in ds {
            d.path = format!("{prefix}.{}", d.path);
            self.items.push(d);
        }
    }
    pub fn has_errors(&self) -> bool {
        self.items.iter().any(|d| d.severity == Severity::Error)
    }
    pub fn into_vec(self) -> Vec<Diagnostic> {
        self.items
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}
