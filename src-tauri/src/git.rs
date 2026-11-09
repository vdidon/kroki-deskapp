//! Uncommitted-change marks: which lines of a document differ from `HEAD`.
//!
//! Pure Rust (`gix` + `imara-diff`), **never the system `git`**: the latter reads
//! the repository's own config, whose `core.fsmonitor`, `filter.*.clean`,
//! `diff.external` and `textconv` run arbitrary commands — opening a document
//! in a cloned repository must not execute anything. `gix` only reads objects,
//! refs, the index and the ignore files here.
//!
//! The price of not running filters: the HEAD blob is the *repository* form of
//! the file. Line endings are therefore normalized on both sides (CRLF → LF,
//! otherwise an `autocrlf` checkout would look entirely modified), and a Git
//! LFS pointer gives no marks at all (its real content is not in the object
//! database).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use imara_diff::{Algorithm, Diff, InternedInput};
use serde::Serialize;

/// Lines (0-based, half-open `[start, end)`) of the file **as it is on disk**
/// that are not in `HEAD`. Pure deletions have no line to mark: they are only
/// flagged by `removed`, so that the tab still shows the file as modified.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct Changes {
    /// Lines with no counterpart in `HEAD` (hunk that only inserts).
    pub added: Vec<[u32; 2]>,
    /// Lines replacing lines of `HEAD`.
    pub modified: Vec<[u32; 2]>,
    /// At least one hunk only deletes lines of `HEAD`.
    pub removed: bool,
    /// The file is in `HEAD` but no longer on disk.
    pub deleted: bool,
    /// The file is not in `HEAD` (untracked, staged only, repository without
    /// a commit): no line is listed — all of them are new, which the tab's dot
    /// says on its own instead of painting the whole document green.
    pub created: bool,
}

/// Repositories already discovered, keyed by the document's folder. Only
/// successes are cached: a folder that becomes a repository (`git init`) is
/// picked up at the next call. `ThreadSafeRepository` re-reads refs, index and
/// packs when they change on disk — the cache never serves a stale `HEAD`.
static REPOS: Mutex<Option<HashMap<PathBuf, gix::ThreadSafeRepository>>> = Mutex::new(None);

/// First ancestor of `dir` (itself included) that holds a `.jj` folder
/// **without** a `.git` next to it: a Jujutsu repository that is not
/// colocated (`jj git init` without `--colocate`) or a secondary workspace
/// (`jj workspace add`). Its git store is internal (`.jj/repo/store/git`)
/// and the working-copy commit's parent `@-` lives only in jj's own op store
/// — the git `HEAD` to compare with does not exist. A colocated repository
/// (`.jj` and `.git` side by side) is fine: jj keeps `HEAD` on `@-`, so
/// "differs from `HEAD`" is exactly "the current change". The walk stops at
/// the first `.git`, which is the repository discovery would pick anyway.
fn non_colocated_jj_root(dir: &Path) -> Option<&Path> {
    for a in dir.ancestors() {
        if a.join(".git").exists() {
            return None;
        }
        if a.join(".jj").is_dir() {
            return Some(a);
        }
    }
    None
}

fn repo_for(dir: &Path) -> Option<gix::Repository> {
    // Without this stop, discovery would climb past the jj repository and
    // land on an enclosing git repository, comparing the document with a
    // repository that does not version it (flagged new, or a stale copy).
    // Checked before the cache: cheap (a few stats), and a folder turned into
    // a jj workspace afterwards must not keep serving the outer repository.
    if non_colocated_jj_root(dir).is_some() {
        return None;
    }
    {
        let cache = REPOS.lock().unwrap();
        if let Some(r) = cache.as_ref().and_then(|m| m.get(dir)) {
            return Some(r.to_thread_local());
        }
    }
    let repo = gix::ThreadSafeRepository::discover(dir).ok()?;
    let local = repo.to_thread_local();
    REPOS
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(dir.to_path_buf(), repo);
    Some(local)
}

/// `.git` folder of the repository holding `path` (worktree-specific folder
/// for a linked worktree: that is where its `index` and `HEAD` live).
pub fn git_dir_for(path: &Path) -> Option<PathBuf> {
    let repo = repo_for(path.parent()?)?;
    repo.workdir()?;
    Some(repo.git_dir().to_path_buf())
}

/// Changes of `path` relative to `HEAD`. `None` = nothing to show: outside a
/// repository, bare repository, ignored file, unreadable file, LFS pointer,
/// file gone from disk that `HEAD` does not know either.
/// A file absent from `HEAD` (untracked, staged only, or repository without a
/// commit) is `created`; a file of `HEAD` gone from disk is `deleted`.
pub fn changes(path: &Path) -> Option<Changes> {
    // A deleted file cannot be canonicalized: its folder still can.
    let (path, exists) = match dunce::canonicalize(path) {
        Ok(p) => (p, true),
        Err(_) => (
            dunce::canonicalize(path.parent()?)
                .ok()?
                .join(path.file_name()?),
            false,
        ),
    };
    let repo = repo_for(path.parent()?)?;
    let workdir = dunce::canonicalize(repo.workdir()?).ok()?;
    let rel = path.strip_prefix(&workdir).ok()?.to_path_buf();
    if rel.as_os_str().is_empty() || rel.starts_with(".git") {
        return None;
    }
    let head_blob = match repo.head_tree() {
        Ok(tree) => match tree.lookup_entry_by_path(&rel).ok()? {
            Some(entry) if entry.mode().is_blob() => Some(entry.object().ok()?.detach().data),
            // A folder or a submodule at this path: not a document we can compare.
            Some(_) => return None,
            None => None,
        },
        // Unborn HEAD (repository without a commit): everything is new.
        Err(_) => None,
    };
    // The file on disk is only read when there is something to compare it
    // with: a new file lists no line, opening it is enough.
    match (head_blob, exists) {
        (Some(_), false) => Some(Changes {
            deleted: true,
            ..Changes::default()
        }),
        (None, false) => None,
        (Some(blob), true) => {
            if is_lfs_pointer(&blob) {
                return None;
            }
            let current = normalize(&std::fs::read(&path).ok()?);
            Some(diff_lines(&normalize(&blob), &current))
        }
        (None, true) => {
            if is_ignored(&repo, &rel) {
                return None;
            }
            // Unreadable file: no marks, as when it is compared.
            std::fs::File::open(&path).ok()?;
            Some(Changes {
                created: true,
                ..Changes::default()
            })
        }
    }
}

fn is_ignored(repo: &gix::Repository, rel: &Path) -> bool {
    // `index_or_empty`: a repository can have no index yet (fresh `git init`);
    // `Worktree::excludes` would then fail and report nothing as ignored.
    let Ok(index) = repo.index_or_empty() else {
        return false;
    };
    let Ok(mut excludes) = repo.excludes(
        &index,
        None,
        gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped,
    ) else {
        return false;
    };
    excludes
        .at_path(rel, Some(gix::index::entry::Mode::FILE))
        .is_ok_and(|p| p.is_excluded())
}

/// Bytes → text with LF line endings (lossy UTF-8: a non-UTF-8 byte only
/// affects its own line, and identically on both sides).
fn normalize(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut s = text.replace("\r\n", "\n");
    // `imara-diff` keeps the terminator in each line: a last line with no
    // final newline would otherwise differ from the same line followed by one.
    if !s.is_empty() && !s.ends_with('\n') {
        s.push('\n');
    }
    s
}

fn is_lfs_pointer(blob: &[u8]) -> bool {
    blob.len() < 1024 && blob.starts_with(b"version https://git-lfs.github.com/spec/")
}

fn diff_lines(before: &str, after: &str) -> Changes {
    let input = InternedInput::new(before, after);
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    // Slides ambiguous hunks onto the most readable boundaries (same
    // heuristics as `git diff`): an insertion between two blank-separated
    // paragraphs lands on the new paragraph, not across both.
    diff.postprocess_lines(&input);
    let mut out = Changes::default();
    for h in diff.hunks() {
        if h.after.is_empty() {
            out.removed = true; // pure deletion: no line to mark, only the tab
            continue;
        }
        let range = [h.after.start, h.after.end];
        if h.before.is_empty() {
            out.added.push(range);
        } else {
            out.modified.push(range);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    impl Changes {
        fn is_empty(&self) -> bool {
            self.added.is_empty()
                && self.modified.is_empty()
                && !self.removed
                && !self.deleted
                && !self.created
        }
    }

    #[test]
    fn ajout_modification_et_suppression() {
        let before = "a\nb\nc\nd\n";
        let after = "a\nB\nc\nnew\nd\n";
        let c = diff_lines(before, after);
        assert_eq!(c.modified, vec![[1, 2]]);
        assert_eq!(c.added, vec![[3, 4]]);
        assert!(!c.removed);
        // A pure deletion marks no line, but the file is flagged as modified.
        let d = diff_lines("a\nb\nc\n", "a\nc\n");
        assert!(d.added.is_empty() && d.modified.is_empty() && d.removed);
    }

    #[test]
    fn fins_de_ligne_et_derniere_ligne_normalisees() {
        let before = normalize(b"a\nb\n");
        assert!(diff_lines(&before, &normalize(b"a\r\nb\r\n")).is_empty());
        assert!(diff_lines(&before, &normalize(b"a\nb")).is_empty());
    }

    #[test]
    fn depot_reel_sha1() {
        depot_reel(gix::hash::Kind::Sha1);
    }

    /// `extensions.objectFormat=sha256`: ids of 64 hex digits, other pack
    /// and index formats — read by the same code path.
    #[test]
    fn depot_reel_sha256() {
        depot_reel(gix::hash::Kind::Sha256);
    }

    /// Real repository built with gix (no system `git` in the tests either).
    fn depot_reel(hash: gix::hash::Kind) {
        let root =
            std::env::temp_dir().join(format!("kroki_git_marks_{hash}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let repo: gix::Repository = gix::ThreadSafeRepository::init(
            &root,
            gix::create::Kind::WithWorktree,
            gix::create::Options {
                object_hash: Some(hash),
                ..Default::default()
            },
        )
        .unwrap()
        .into();
        assert_eq!(repo.object_hash(), hash);

        // Commit of `doc.md` (one blob, one tree, one commit on HEAD).
        let blob = repo.write_blob(b"titre\n\npara\n").unwrap().detach();
        let tree = gix::objs::Tree {
            entries: vec![gix::objs::tree::Entry {
                mode: gix::objs::tree::EntryKind::Blob.into(),
                filename: "doc.md".into(),
                oid: blob,
            }],
        };
        let tree_id = repo.write_object(&tree).unwrap().detach();
        repo.commit("HEAD", "init", tree_id, gix::commit::NO_PARENT_IDS)
            .unwrap();

        std::fs::write(root.join("doc.md"), "titre\n\npara modifié\najout\n").unwrap();
        std::fs::write(root.join("neuf.md"), "un\ndeux\n").unwrap();
        std::fs::write(root.join(".gitignore"), "ignore.md\n").unwrap();
        std::fs::write(root.join("ignore.md"), "x\n").unwrap();

        let c = changes(&root.join("doc.md")).unwrap();
        assert_eq!(c.modified, vec![[2, 4]]);
        assert!(c.added.is_empty());
        // A new file lists no line: the tab's dot alone says it is new.
        assert_eq!(
            changes(&root.join("neuf.md")),
            Some(Changes {
                created: true,
                ..Changes::default()
            })
        );
        assert_eq!(changes(&root.join("ignore.md")), None);
        assert!(git_dir_for(&root.join("doc.md")).is_some());

        // File of HEAD deleted from disk; an untracked file gone leaves nothing.
        std::fs::remove_file(root.join("doc.md")).unwrap();
        assert!(changes(&root.join("doc.md")).unwrap().deleted);
        std::fs::remove_file(root.join("neuf.md")).unwrap();
        assert_eq!(changes(&root.join("neuf.md")), None);

        // jj repository nested in the git one. Non-colocated (`.jj` alone):
        // no marks, instead of comparing with the enclosing repository where
        // the file is untracked (it would come out flagged new).
        let jj = root.join("jj");
        std::fs::create_dir_all(jj.join(".jj").join("repo")).unwrap();
        std::fs::create_dir_all(jj.join("sub")).unwrap();
        std::fs::write(jj.join("sub").join("doc.md"), "x\n").unwrap();
        assert_eq!(changes(&jj.join("sub").join("doc.md")), None);
        assert_eq!(git_dir_for(&jj.join("sub").join("doc.md")), None);
        // Colocated (`.jj` + `.git`): the git repository next to it is used.
        let colo = root.join("colo");
        std::fs::create_dir_all(colo.join(".jj")).unwrap();
        gix::init(&colo).unwrap();
        std::fs::write(colo.join("doc.md"), "x\n").unwrap();
        assert!(changes(&colo.join("doc.md")).unwrap().created);

        // Outside any repository.
        let outside =
            std::env::temp_dir().join(format!("kroki_git_none_{hash}_{}", std::process::id()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("a.md"), "a\n").unwrap();
        // The temp folder could itself sit inside a repository: only check
        // when it does not.
        if gix::discover(&outside).is_err() {
            assert_eq!(changes(&outside.join("a.md")), None);
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
