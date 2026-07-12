# Work Summary - July 12, 2026

This document details the refactoring, features, bug fixes, and architectural adjustments completed today.

---

## 🛠️ Work Accomplished & Refactoring

1. **Deprecated `react-window` and built Native VirtualList:**
   * Removed `react-window` (v2.2.7) due to height calculation resets, ESM module rendering issues in Vite, and rendering blanks.
   * Implemented a lightweight, native React virtualization scroll container `<VirtualList>` in `App.tsx` mapped directly to scroll events and CSS absolute coordinates, restoring 100% list rendering reliability.
2. **Multi-Selection UI & Concurrent Actions:**
   * Swapped selection states from a single item string to map dictionaries (`Record<string, boolean>`).
   * Configured key listeners for `Cmd`/`Ctrl`/`Shift` and checkbox buttons on rows to enable batch selection.
   * Updated backend commands (`handleDelete`, `executePush`, `executePull`) to run concurrently on selected arrays.
3. **Dedicated Directory Entry Chevron Buttons:**
   * Added arrow chevron indicators on folder items to bypass click conflicts on draggable rows, ensuring folder navigation remains accessible.

---

## 🐛 Bugs Resolved & Technical Solutions

### 1. Progress Bar Jumps (ADB Pipe Buffering Bug)
* **Problem:** Interactive progress updates (e.g. `[ 52%]`) printed by `adb push/pull -p` commands were buffered by the OS when launched inside Tauri's non-interactive pipe. As a result, the progress bar went from `Preparing` directly to `Completed` with no updates in-between.
* **Solution:** Replaced stdout/stderr regex parsing inside Rust's `TransferManager` with a **Disk-Size Polling Progress Monitor**. The backend now spawns a lightweight async loop that runs every 250ms during a transfer:
  * **Push (Mac ➔ Android):** Polls the Android temp destination file size using `adb shell stat -c '%s'`.
  * **Pull (Android ➔ Mac):** Polls the Mac temp destination file size using `std::fs::metadata`.
  * Real-time transfer speeds, remaining byte stats, and remaining time (ETA) are dynamically calculated and emitted to the UI, yielding smooth, reliable progress updates.

### 2. Draggable Row double-click loss (React Re-renders)
* **Problem:** Double-clicks on folder rows failed to navigate inside folders. This occurred because `renderRow` was dynamically generated inside the `App` component, causing React to unmount and remount row items on every state update, losing the click timer references and aborting active drag sequences.
* **Solution:** Refactored `FileRow` to a static, top-level module-scoped component. Added a custom double-click resolver using `useRef` and a `280ms` click threshold in the row's `onClick` event. This successfully restores double-click navigation on draggable items.

### 3. Drag-and-Drop Aborts (WebKit Restrictions & React Closures)
* **Problem:** Dropping rows onto the opposite panel failed to start transfers, and dragged rows highlighted standard text selections instead of dragging elements.
* **Solution:**
  * Configured `select-none` on the VirtualList viewport to disable text highlighting during grabs.
  * Stored target file details inside `(window as any).__draggedFile` to prevent React closure delays during drag events.
  * Added `onDragEnter={(e) => e.preventDefault()}` alongside `onDragOver` on drop sections to satisfy macOS WebKit requirements, enabling standard drop triggers to fire.

---

## 📈 Compilation & Build Status

* **Frontend Build:** Production build (`tsc && vite build`) compiles with **zero warnings** and zero errors.
* **Rust Backend Build:** Backend compiles cleanly under `cargo check` with **zero errors**.
