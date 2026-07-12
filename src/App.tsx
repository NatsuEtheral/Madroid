import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Folder,
  File,
  Smartphone,
  Laptop,
  ChevronRight,
  RefreshCw,
  Trash2,
  Edit3,
  FolderPlus,
  X,
  Wifi,
  Usb,
  AlertTriangle,
  Settings,
  Activity,
  AlertCircle,
  Info
} from "lucide-react";
import "./App.css";

// Format Helpers (Top-level)
const formatBytes = (bytes: number) => {
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

// Generic Virtualized List implementation to prevent library/ESM package bugs
interface VirtualListProps {
  itemCount: number;
  rowHeight: number;
  rowComponent: any;
  height: number;
  itemData: any;
}

function VirtualList({ itemCount, rowHeight, rowComponent: RowComponent, height, itemData }: VirtualListProps) {
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const totalHeight = itemCount * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const endIndex = Math.min(itemCount - 1, Math.floor((scrollTop + height) / rowHeight) + 4);

  const visibleItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push(
      <RowComponent
        key={i}
        index={i}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: rowHeight,
          transform: `translateY(${i * rowHeight}px)`,
        }}
        data={itemData}
      />
    );
  }

  return (
    <div
      onScroll={handleScroll}
      className="flex-1 w-full overflow-y-auto min-h-0 relative select-none"
      style={{
        height: "100%",
      }}
    >
      <div style={{ height: `${totalHeight}px`, width: "100%", position: "relative" }}>
        {visibleItems}
      </div>
    </div>
  );
}

interface FileRowProps {
  index: number;
  style: React.CSSProperties;
  data: {
    files: FileInfo[];
    selectedMap: Record<string, boolean>;
    setSelectedMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    onDoubleClick: (file: FileInfo) => void;
    isLocal: boolean;
  };
}

const FileRow = ({ index, style, data }: FileRowProps) => {
  const { files, selectedMap, setSelectedMap, onDoubleClick, isLocal } = data;
  const file = files[index];
  if (!file) return null;
  const isSelected = !!selectedMap[file.name];
  
  const lastClickTime = useRef(0);

  const handleRowClick = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastClickTime.current < 280) {
      onDoubleClick(file);
      return;
    }
    lastClickTime.current = now;

    setSelectedMap((prev) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        return {
          ...prev,
          [file.name]: !prev[file.name],
        };
      } else {
        return {
          [file.name]: true,
        };
      }
    });
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedMap((prev) => ({
      ...prev,
      [file.name]: e.target.checked,
    }));
  };

  const handleDragStart = (e: React.DragEvent) => {
    (window as any).__draggedFile = { name: file.name, isLocal };
    e.dataTransfer.setData("drag-direction", isLocal ? "push" : "pull");
    e.dataTransfer.setData("file-name", file.name);
  };

  return (
    <div
      style={style}
      onClick={handleRowClick}
      draggable={true}
      onDragStart={handleDragStart}
      className={`flex items-center px-4 py-2 border-b border-slate-900/50 cursor-pointer select-none transition-colors duration-150 ${
        isSelected
          ? "bg-indigo-600/30 border-l-2 border-l-indigo-500"
          : "hover:bg-slate-800/40 text-slate-300"
      }`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={handleCheckboxChange}
        className="w-4 h-4 mr-3 accent-indigo-600 cursor-pointer shrink-0 rounded border-slate-700 bg-slate-950/40"
      />

      {file.is_dir ? (
        <Folder className="w-5 h-5 mr-3 text-indigo-400 fill-indigo-400/10 flex-shrink-0" />
      ) : (
        <File className="w-5 h-5 mr-3 text-slate-400 flex-shrink-0" />
      )}
      <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
      <span className="text-xs text-slate-500 w-24 text-right flex-shrink-0 mr-4">
        {file.is_dir ? "-" : formatBytes(file.size)}
      </span>
      <span className="text-xs text-slate-500 w-32 truncate text-right flex-shrink-0">
        {file.modified.split("T")[0] || file.modified || "-"}
      </span>
      {file.is_dir ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDoubleClick(file);
          }}
          className="p-1 ml-3 hover:bg-slate-700/80 rounded text-slate-400 hover:text-white transition-colors flex-shrink-0 cursor-pointer"
          title="Enter folder"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      ) : (
        <div className="w-6 ml-3 flex-shrink-0" />
      )}
    </div>
  );
};

// Interface definitions
interface FileInfo {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string;
  permissions: string;
}

interface Device {
  serial: string;
  model: string;
  android_version: string;
  authorized: boolean;
  connection_type: "USB" | "Wireless";
}

interface TransferTask {
  id: string;
  src_path: string;
  dest_path: string;
  direction: "Push" | "Pull";
  total_bytes: number;
  state: {
    status: "Queued" | "Preparing" | "Running" | "Verifying" | "Completed" | "Failed" | "Cancelled";
    payload?: any;
  };
}

function App() {
  // Device states
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [selectedDeviceDetails, setSelectedDeviceDetails] = useState<Device | null>(null);
  
  // Storage paths
  const [localPath, setLocalPath] = useState<string>("/Users/hussain/Downloads");
  const [remotePath, setRemotePath] = useState<string>("/sdcard");
  
  // File listings
  const [localFiles, setLocalFiles] = useState<FileInfo[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<FileInfo[]>([]);
  
  // Selection states
  const [selectedLocal, setSelectedLocal] = useState<Record<string, boolean>>({});
  const [selectedRemote, setSelectedRemote] = useState<Record<string, boolean>>({});
  const [isDraggingOverLocal, setIsDraggingOverLocal] = useState(false);

  const getSingleSelected = (selected: Record<string, boolean>): string | null => {
    const keys = Object.keys(selected).filter((k) => selected[k]);
    return keys.length === 1 ? keys[0] : null;
  };

  const getSelectedCount = (selected: Record<string, boolean>): number => {
    return Object.keys(selected).filter((k) => selected[k]).length;
  };

  const getSelectedList = (selected: Record<string, boolean>): string[] => {
    return Object.keys(selected).filter((k) => selected[k]);
  };
  
  // Transfer Queue & Drawer states
  const [transfers, setTransfers] = useState<Record<string, TransferTask>>({});
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  
  // Modal states
  const [isWirelessOpen, setIsWirelessOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  
  // Input bindings
  const [wirelessIp, setWirelessIp] = useState("");
  const [wirelessPort, setWirelessPort] = useState(5555);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [activePane, setActivePane] = useState<"local" | "remote">("local");
  
  // Settings bindings
  const [showHidden, setShowHidden] = useState(false);
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [checksumVerify, setChecksumVerify] = useState(false);

  // Drag states
  const [isDraggingOverRemote, setIsDraggingOverRemote] = useState(false);

  // Initialize and load files
  useEffect(() => {
    // 1. Initial Device Detection
    fetchDevices();

    // 2. Fetch Local Path on load (attempt home path)
    loadLocalFiles(localPath);

    // 3. Set up event listeners from Tauri backend
    const unsubscribes: any[] = [];

    const setupListeners = async () => {
      // Listen to directory updates (after successful file transfers, deletes, etc.)
      const un_dir = await listen("directory:updated", () => {
        refreshAll();
      });
      unsubscribes.push(un_dir);

      // Listen to transfer events
      const eventNames = [
        "transfer:queued",
        "transfer:started",
        "transfer:progress",
        "transfer:finished",
        "transfer:failed",
        "transfer:cancelled",
      ];

      for (const name of eventNames) {
        const un = await listen(name, (event: any) => {
          const task = event.payload as TransferTask;
          setTransfers((prev) => ({
            ...prev,
            [task.id]: task,
          }));
          
          // Open queue drawer automatically when a transfer starts
          if (name === "transfer:started") {
            setIsQueueOpen(true);
          }
        });
        unsubscribes.push(un);
      }

      // 4. Native Drag-and-Drop listener (Tauri level)
      // When files are dropped from Finder into the Tauri Window, push them to Android
      const un_drop = await listen("tauri://drag-drop", (event: any) => {
        if (selectedDevice && event.payload && event.payload.paths) {
          const files = event.payload.paths as string[];
          for (const file of files) {
            const parts = file.split("/");
            const fileName = parts[parts.length - 1] || file;
            const dest = `${remotePath}/${fileName}`;
            startTransfer(file, dest, "push");
          }
        }
      });
      unsubscribes.push(un_drop);
    };

    setupListeners();

    // 5. Polling connected devices (every 3 seconds)
    const pollInterval = setInterval(() => {
      fetchDevices();
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      for (const un of unsubscribes) {
        un();
      }
    };
  }, [selectedDevice, localPath, remotePath]);

  // Load directories when paths change
  useEffect(() => {
    loadLocalFiles(localPath);
  }, [localPath]);

  useEffect(() => {
    if (selectedDevice) {
      loadRemoteFiles(remotePath);
    } else {
      setRemoteFiles([]);
    }
  }, [selectedDevice, remotePath]);

  const refreshAll = () => {
    loadLocalFiles(localPath);
    if (selectedDevice) {
      loadRemoteFiles(remotePath);
    }
  };

  const fetchDevices = async () => {
    try {
      const list = await invoke<Device[]>("list_devices");
      setDevices(list);

      // Auto-select first device if none is selected
      if (list.length > 0) {
        if (!selectedDevice || !list.some((d) => d.serial === selectedDevice)) {
          handleSelectDevice(list[0].serial);
        } else {
          const current = list.find((d) => d.serial === selectedDevice);
          if (current) {
            setSelectedDeviceDetails(current);
          }
        }
      } else {
        setSelectedDevice(null);
        setSelectedDeviceDetails(null);
      }
    } catch (err) {
      console.error("Failed to list devices", err);
    }
  };

  const handleSelectDevice = async (serial: string) => {
    try {
      await invoke("select_device", { serial });
      setSelectedDevice(serial);
      const details = devices.find((d) => d.serial === serial) || null;
      setSelectedDeviceDetails(details);
      setRemotePath("/sdcard");
      loadRemoteFiles("/sdcard");
    } catch (err) {
      console.error("Failed to select device", err);
    }
  };

  // Filesystem loaders
  const loadLocalFiles = async (path: string) => {
    try {
      const files = await invoke<FileInfo[]>("read_dir", { path, isLocal: true });
      // Filter hidden if off
      setLocalFiles(showHidden ? files : files.filter((f) => !f.name.startsWith(".")));
    } catch (err: any) {
      console.error("Failed to load local files", err);
      alert(`Local Filesystem Error (Path: ${path}): ${err.message || JSON.stringify(err)}`);
    }
  };

  const loadRemoteFiles = async (path: string) => {
    try {
      const files = await invoke<FileInfo[]>("read_dir", { path, isLocal: false });
      setRemoteFiles(showHidden ? files : files.filter((f) => !f.name.startsWith(".")));
    } catch (err: any) {
      console.error("Failed to load remote files", err);
      alert(`Remote Filesystem Error (Path: ${path}): ${err.message || JSON.stringify(err)}`);
    }
  };

  // Directories handlers
  const handleLocalNavigation = (file: FileInfo) => {
    if (file.is_dir) {
      setSelectedLocal({});
      setLocalPath(`${localPath}/${file.name}`);
    }
  };

  const handleRemoteNavigation = (file: FileInfo) => {
    if (file.is_dir) {
      setSelectedRemote({});
      setRemotePath(`${remotePath}/${file.name}`);
    }
  };

  const goUpLocal = () => {
    const parts = localPath.split("/");
    if (parts.length > 2) {
      parts.pop();
      setLocalPath(parts.join("/"));
      setSelectedLocal({});
    }
  };

  const goUpRemote = () => {
    const parts = remotePath.split("/");
    if (parts.length > 2) {
      parts.pop();
      setRemotePath(parts.join("/"));
      setSelectedRemote({});
    }
  };

  // Core Actions
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const isLocal = activePane === "local";
    const basePath = isLocal ? localPath : remotePath;
    const fullPath = `${basePath}/${newFolderName}`;

    try {
      await invoke("create_dir", { path: fullPath, isLocal });
      setIsNewFolderOpen(false);
      setNewFolderName("");
      refreshAll();
    } catch (err: any) {
      alert(`Error creating directory: ${err.message || err}`);
    }
  };

  const handleDelete = async () => {
    const isLocal = activePane === "local";
    const selectedMap = isLocal ? selectedLocal : selectedRemote;
    const selectedList = getSelectedList(selectedMap);
    if (selectedList.length === 0) return;

    const message = selectedList.length === 1 
      ? `Are you sure you want to delete "${selectedList[0]}"?`
      : `Are you sure you want to delete the ${selectedList.length} selected items?`;

    if (!confirm(message)) return;

    const basePath = isLocal ? localPath : remotePath;

    try {
      for (const item of selectedList) {
        const fullPath = `${basePath}/${item}`;
        await invoke("remove_item", { path: fullPath, isLocal });
      }
      if (isLocal) setSelectedLocal({});
      else setSelectedRemote({});
      refreshAll();
    } catch (err: any) {
      alert(`Error deleting: ${err.message || err}`);
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    const isLocal = activePane === "local";
    const selected = getSingleSelected(isLocal ? selectedLocal : selectedRemote);
    if (!selected) return;

    const basePath = isLocal ? localPath : remotePath;
    const src = `${basePath}/${selected}`;
    const dest = `${basePath}/${renameValue}`;

    try {
      await invoke("rename_item", { src, dest, isLocal });
      setIsRenameOpen(false);
      setRenameValue("");
      if (isLocal) setSelectedLocal({});
      else setSelectedRemote({});
      refreshAll();
    } catch (err: any) {
      alert(`Error renaming: ${err.message || err}`);
    }
  };

  // Transfers
  const startTransfer = async (src: string, dest: string, direction: "push" | "pull") => {
    try {
      await invoke("start_transfer", { src, dest, direction });
    } catch (err: any) {
      alert(`Failed to start transfer: ${err.message || err}`);
    }
  };

  const executePush = () => {
    const selectedList = getSelectedList(selectedLocal);
    if (selectedList.length === 0 || !selectedDevice) return;
    for (const item of selectedList) {
      const src = `${localPath}/${item}`;
      const dest = `${remotePath}/${item}`;
      startTransfer(src, dest, "push");
    }
  };

  const executePull = () => {
    const selectedList = getSelectedList(selectedRemote);
    if (selectedList.length === 0 || !selectedDevice) return;
    for (const item of selectedList) {
      const src = `${remotePath}/${item}`;
      const dest = `${localPath}/${item}`;
      startTransfer(src, dest, "pull");
    }
  };

  const handleCancelTransfer = async (id: string) => {
    try {
      await invoke("cancel_transfer", { taskId: id });
    } catch (err: any) {
      alert(`Cancel failed: ${err.message || err}`);
    }
  };

  // Wireless Actions
  const handleConnectWireless = async () => {
    try {
      await invoke("connect_wireless", { ip: wirelessIp, port: wirelessPort });
      setIsWirelessOpen(false);
      fetchDevices();
    } catch (err: any) {
      alert(`Wireless connection failed: ${err.message || err}`);
    }
  };

  const handleEnableTcpip = async () => {
    if (!selectedDevice) return;
    try {
      await invoke("enable_tcpip", { serial: selectedDevice, port: 5555 });
      // Fetch gateway/phone IP
      const gw = await invoke<string>("get_gateway_ip");
      setWirelessIp(gw);
      alert(`TCP/IP enabled on port 5555. Phone gateway IP is detected as: ${gw}. You can now configure the Wi-Fi connection.`);
    } catch (err: any) {
      alert(`Failed to enable TCP/IP: ${err.message || err}`);
    }
  };

  // Format Helpers
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "-";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps <= 0) return "0 B/s";
    return formatBytes(bps) + "/s";
  };

  const formatETA = (seconds: number) => {
    if (!seconds || seconds === Infinity || isNaN(seconds) || seconds <= 0) return "Estimating...";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  };



  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden text-slate-100">
      
      {/* 🚀 DEVICE & STATUS HEADER */}
      <header className="flex items-center justify-between px-6 py-4 glass-panel border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Smartphone className="w-6 h-6 text-indigo-400" />
          <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Madroid
          </h1>
        </div>

        {/* Device selector / status */}
        <div className="flex items-center gap-4">
          {devices.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedDevice || ""}
                onChange={(e) => handleSelectDevice(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
              >
                {devices.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.model} ({d.serial})
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-400">
                {selectedDeviceDetails?.connection_type === "Wireless" ? (
                  <Wifi className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Usb className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>OS {selectedDeviceDetails?.android_version || "-"}</span>
                {selectedDeviceDetails?.authorized ? (
                  <span className="w-2 h-2 rounded-full bg-green-500 ml-1"></span>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-yellow-500 ml-1"></span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/30 border border-red-900/40 rounded-lg text-xs font-semibold text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>No Device Connected</span>
            </div>
          )}

          <button
            onClick={() => setIsWirelessOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5" />
            Wireless Handoff
          </button>
          
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </header>

      {/* 📂 SPLIT PANE WORKSPACE */}
      <main className="flex-1 flex overflow-hidden p-6 gap-6">
        
        {/* LEFT PANE: LOCAL MACOS */}
        <section
          onClick={() => setActivePane("local")}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOverLocal(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDraggingOverLocal(true);
          }}
          onDragLeave={() => setIsDraggingOverLocal(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOverLocal(false);
            const dragged = (window as any).__draggedFile;
            if (dragged) {
              if (!dragged.isLocal) {
                const src = `${remotePath}/${dragged.name}`;
                const dest = `${localPath}/${dragged.name}`;
                startTransfer(src, dest, "pull");
              }
              (window as any).__draggedFile = null;
              return;
            }
            const direction = e.dataTransfer.getData("drag-direction");
            const fileName = e.dataTransfer.getData("file-name");
            if (direction === "pull" && fileName) {
              const src = `${remotePath}/${fileName}`;
              const dest = `${localPath}/${fileName}`;
              startTransfer(src, dest, "pull");
            }
          }}
          className={`flex-1 flex flex-col rounded-xl glass-panel transition-all duration-300 relative ${
            activePane === "local" ? "ring-2 ring-indigo-500/30 border-indigo-500/50" : ""
          } ${isDraggingOverLocal ? "bg-indigo-950/20 border-indigo-500/70" : ""}`}
        >
          {isDraggingOverLocal && (
            <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none rounded-xl">
              <div className="flex flex-col items-center text-indigo-400 gap-2">
                <FolderPlus className="w-12 h-12 animate-bounce" />
                <span className="font-semibold text-lg">Drop to Pull to Mac</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/30 rounded-t-xl">
            <div className="flex items-center gap-2">
              <Laptop className="w-5 h-5 text-indigo-400" />
              <span className="font-semibold text-sm">Mac Storage ({localFiles.length})</span>
            </div>
            
            {/* Local breadcrumbs */}
            <div className="flex items-center gap-1 text-xs text-slate-500 font-mono truncate max-w-md">
              <button
                onClick={goUpLocal}
                className="hover:text-slate-200 transition-colors cursor-pointer px-1 py-0.5 rounded bg-slate-900 border border-slate-800"
              >
                Up
              </button>
              <span className="truncate">{localPath}</span>
            </div>
          </div>

          {/* Local Action Row */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/20 text-xs">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setActivePane("local");
                  setIsNewFolderOpen(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-800 rounded text-slate-300 font-semibold cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                New Folder
              </button>
              {getSelectedCount(selectedLocal) > 0 && (
                <>
                  {getSelectedCount(selectedLocal) === 1 && (
                    <button
                      onClick={() => {
                        setActivePane("local");
                        const single = getSingleSelected(selectedLocal);
                        if (single) {
                          setRenameValue(single);
                          setIsRenameOpen(true);
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-800 rounded text-slate-300 font-semibold cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Rename
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setActivePane("local");
                      handleDelete();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-red-950/50 hover:text-red-400 rounded text-slate-400 font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => loadLocalFiles(localPath)}
              className="p-1.5 hover:bg-slate-800 rounded text-slate-400 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Local Virtualized List */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {localFiles.length > 0 ? (
              <>
                <VirtualList
                  height={500}
                  itemCount={localFiles.length}
                  rowHeight={40}
                  rowComponent={FileRow}
                  itemData={{
                    files: localFiles,
                    selectedMap: selectedLocal,
                    setSelectedMap: setSelectedLocal,
                    onDoubleClick: handleLocalNavigation,
                    isLocal: true,
                  }}
                />
                <div className="absolute bottom-2 left-2 right-2 bg-slate-950/95 border border-slate-800 p-2 rounded text-[10px] text-indigo-400 max-h-24 overflow-y-auto z-50 font-mono">
                  <div>[DEBUG] Standard list fallback (First 3 files):</div>
                  {localFiles.slice(0, 3).map(f => (
                    <div key={f.name as string}>- {f.name} ({f.is_dir ? "Dir" : "File"})</div>
                  ))}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                <Info className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm">Empty Folder</span>
              </div>
            )}
          </div>
        </section>

        {/* ⇆ DUAL TRANSFER BUTTON CONTAINER */}
        <section className="flex flex-col justify-center items-center gap-3">
          <button
            onClick={executePush}
            disabled={getSelectedCount(selectedLocal) === 0 || !selectedDevice}
            className={`p-3.5 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
              getSelectedCount(selectedLocal) > 0 && selectedDevice
                ? "bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                : "bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed"
            }`}
            title="Transfer selected Mac file to Android"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          <button
            onClick={executePull}
            disabled={getSelectedCount(selectedRemote) === 0 || !selectedDevice}
            className={`p-3.5 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
              getSelectedCount(selectedRemote) > 0 && selectedDevice
                ? "bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                : "bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed"
            }`}
            title="Transfer selected Android file to Mac"
          >
            <ChevronRight className="w-6 h-6 rotate-180" />
          </button>
        </section>

        {/* RIGHT PANE: REMOTE ANDROID */}
        <section
          onClick={() => setActivePane("remote")}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOverRemote(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDraggingOverRemote(true);
          }}
          onDragLeave={() => setIsDraggingOverRemote(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOverRemote(false);
            const dragged = (window as any).__draggedFile;
            if (dragged) {
              if (dragged.isLocal) {
                const src = `${localPath}/${dragged.name}`;
                const dest = `${remotePath}/${dragged.name}`;
                startTransfer(src, dest, "push");
              }
              (window as any).__draggedFile = null;
              return;
            }
            const direction = e.dataTransfer.getData("drag-direction");
            const fileName = e.dataTransfer.getData("file-name");
            if (direction === "push" && fileName) {
              const src = `${localPath}/${fileName}`;
              const dest = `${remotePath}/${fileName}`;
              startTransfer(src, dest, "push");
            }
          }}
          className={`flex-1 flex flex-col rounded-xl glass-panel transition-all duration-300 relative ${
            activePane === "remote" ? "ring-2 ring-indigo-500/30 border-indigo-500/50" : ""
          } ${isDraggingOverRemote ? "bg-indigo-950/20 border-indigo-500/70" : ""}`}
        >
          {isDraggingOverRemote && (
            <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none rounded-xl">
              <div className="flex flex-col items-center text-indigo-400 gap-2">
                <FolderPlus className="w-12 h-12 animate-bounce" />
                <span className="font-semibold text-lg">Drop to Push to Android</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/30 rounded-t-xl">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-indigo-400" />
              <span className="font-semibold text-sm">Android Device ({remoteFiles.length})</span>
            </div>

            {/* Remote breadcrumbs */}
            <div className="flex items-center gap-1 text-xs text-slate-500 font-mono truncate max-w-md">
              <button
                onClick={goUpRemote}
                disabled={!selectedDevice}
                className="hover:text-slate-200 transition-colors disabled:cursor-not-allowed cursor-pointer px-1 py-0.5 rounded bg-slate-900 border border-slate-800"
              >
                Up
              </button>
              <span className="truncate">{remotePath}</span>
            </div>
          </div>

          {/* Remote Action Row */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/20 text-xs">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setActivePane("remote");
                  setIsNewFolderOpen(true);
                }}
                disabled={!selectedDevice}
                className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-transparent rounded text-slate-300 font-semibold cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                New Folder
              </button>
              {getSelectedCount(selectedRemote) > 0 && (
                <>
                  {getSelectedCount(selectedRemote) === 1 && (
                    <button
                      onClick={() => {
                        setActivePane("remote");
                        const single = getSingleSelected(selectedRemote);
                        if (single) {
                          setRenameValue(single);
                          setIsRenameOpen(true);
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-800 rounded text-slate-300 font-semibold cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Rename
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setActivePane("remote");
                      handleDelete();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-red-950/50 hover:text-red-400 rounded text-slate-400 font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => selectedDevice && loadRemoteFiles(remotePath)}
              disabled={!selectedDevice}
              className="p-1.5 hover:bg-slate-800 rounded text-slate-400 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Remote Virtualized List */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {!selectedDevice ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                <AlertCircle className="w-12 h-12 mb-3 text-slate-600" />
                <h3 className="font-bold text-slate-400 mb-1">Android Disconnected</h3>
                <p className="text-xs max-w-xs text-slate-500">
                  Connect your phone via USB cable and allow debugging or click "Wireless Handoff" to pair.
                </p>
              </div>
            ) : selectedDeviceDetails && !selectedDeviceDetails.authorized ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 p-6 text-center bg-slate-950/10">
                <AlertTriangle className="w-12 h-12 mb-3 text-yellow-500 animate-bounce" />
                <h3 className="font-bold text-slate-300 mb-1">Authorization Required</h3>
                <p className="text-xs max-w-sm text-slate-400 mb-4">
                  Please check your phone screen. Accept the RSA Fingerprint / USB debugging request to connect.
                </p>
                <button
                  onClick={fetchDevices}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold text-white cursor-pointer"
                >
                  Verify Authorization
                </button>
              </div>
            ) : remoteFiles.length > 0 ? (
              <>
                <VirtualList
                  height={500}
                  itemCount={remoteFiles.length}
                  rowHeight={40}
                  rowComponent={FileRow}
                  itemData={{
                    files: remoteFiles,
                    selectedMap: selectedRemote,
                    setSelectedMap: setSelectedRemote,
                    onDoubleClick: handleRemoteNavigation,
                    isLocal: false,
                  }}
                />
                <div className="absolute bottom-2 left-2 right-2 bg-slate-950/95 border border-slate-800 p-2 rounded text-[10px] text-indigo-400 max-h-24 overflow-y-auto z-50 font-mono">
                  <div>[DEBUG] Standard list fallback (First 3 files):</div>
                  {remoteFiles.slice(0, 3).map(f => (
                    <div key={f.name as string}>- {f.name} ({f.is_dir ? "Dir" : "File"})</div>
                  ))}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                <Info className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm">Empty Folder</span>
              </div>
            )}
          </div>
        </section>

      </main>

      {/* 📊 DYNAMIC TRANSFER QUEUE DRAWER */}
      <footer className="w-full bg-slate-950 border-t border-slate-800">
        
        {/* Toggle Bar */}
        <div
          onClick={() => setIsQueueOpen(!isQueueOpen)}
          className="flex items-center justify-between px-6 py-3 cursor-pointer hover:bg-slate-900 border-b border-slate-900 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold tracking-wide uppercase text-slate-400">
              Active Transfers ({Object.values(transfers).filter(t => t.state.status !== "Completed" && t.state.status !== "Failed" && t.state.status !== "Cancelled").length})
            </span>
          </div>
          <span className="text-xs text-indigo-400 font-semibold">
            {isQueueOpen ? "Collapse Drawer" : "Expand Drawer"}
          </span>
        </div>

        {/* Drawer Content */}
        {isQueueOpen && (
          <div className="max-h-56 overflow-y-auto p-4 flex flex-col gap-3">
            {Object.values(transfers).length > 0 ? (
              Object.values(transfers).map((task) => {
                const isRunning = task.state.status === "Running";
                const isFailed = task.state.status === "Failed";
                const isCompleted = task.state.status === "Completed";
                const metrics = isRunning ? task.state.payload : null;
                const progress = metrics?.percentage || (isCompleted ? 100 : 0);

                return (
                  <div key={task.id} className="flex items-center justify-between bg-slate-900/60 border border-slate-900 p-3 rounded-lg text-xs gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="font-semibold text-slate-200 truncate flex-1">{task.src_path.split("/").pop()}</span>
                        <span className={`font-semibold shrink-0 ${
                          isCompleted ? "text-green-400" : isFailed ? "text-red-400" : "text-indigo-400 animate-pulse"
                        }`}>
                          {task.state.status}
                        </span>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden mb-1">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isCompleted ? "bg-green-500" : isFailed ? "bg-red-500" : "bg-indigo-500"
                          }`}
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>

                      {/* Info Row */}
                      {isRunning && metrics && (
                        <div className="flex justify-between text-slate-500 text-[10px] font-medium">
                          <span>{formatBytes(metrics.bytes_transferred)} of {formatBytes(metrics.total_bytes)}</span>
                          <span>{formatSpeed(metrics.speed_bps)}</span>
                          <span>{formatETA(metrics.eta_seconds)} remaining</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!isCompleted && !isFailed && task.state.status !== "Cancelled" && (
                      <button
                        onClick={() => handleCancelTransfer(task.id)}
                        className="p-1.5 hover:bg-slate-800 rounded border border-slate-800 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                        title="Cancel Transfer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-slate-600 text-xs">
                No active or recent transfers
              </div>
            )}
          </div>
        )}
      </footer>

      {/* 🛜 WIRELESS HANDOFF WIZARD MODAL */}
      {isWirelessOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 relative">
            <button
              onClick={() => setIsWirelessOpen(false)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-lg">
                <Wifi className="w-5 h-5" />
              </div>
              <h2 className="text-md font-bold text-slate-100">Wireless Handoff Setup</h2>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Unplug cables safely and transfer files over Wi-Fi. The phone must be on the same network or connected to the Mac hotspot.
            </p>

            <div className="flex flex-col gap-4">
              
              <div className="bg-slate-950/50 border border-slate-950 p-4 rounded-lg flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Step 1: Bootstrap USB</span>
                <p className="text-[11px] text-slate-400">
                  Ensure the phone is plugged in via USB first. Click the button to configure port 5555.
                </p>
                <button
                  onClick={handleEnableTcpip}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-bold text-slate-300 transition-colors cursor-pointer"
                >
                  Configure TCP/IP Port
                </button>
              </div>

              <div className="bg-slate-950/50 border border-slate-950 p-4 rounded-lg flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Step 2: Connect Wireless</span>
                <p className="text-[11px] text-slate-400">
                  Input the gateway/phone IP to complete the wireless connection.
                </p>
                <div className="flex gap-2">
                  <input
                    value={wirelessIp}
                    onChange={(e) => setWirelessIp(e.target.value)}
                    placeholder="Phone IP (e.g. 192.168.43.1)"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <input
                    type="number"
                    value={wirelessPort}
                    onChange={(e) => setWirelessPort(parseInt(e.target.value))}
                    placeholder="Port"
                    className="w-20 bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <button
                  onClick={handleConnectWireless}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white transition-colors cursor-pointer"
                >
                  Pair Device Wireless
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ⚙️ SETTINGS SYSTEM MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 relative">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-lg">
                <Settings className="w-5 h-5" />
              </div>
              <h2 className="text-md font-bold text-slate-100">Preferences</h2>
            </div>

            <div className="flex flex-col gap-4 text-xs">
              <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-lg border border-slate-950">
                <div>
                  <div className="font-semibold text-slate-200">Show Hidden Files</div>
                  <div className="text-[10px] text-slate-500">Show files starting with dot (.)</div>
                </div>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
              </div>

              <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-lg border border-slate-950">
                <div>
                  <div className="font-semibold text-slate-200">Post-Transfer Checksums</div>
                  <div className="text-[10px] text-slate-500">Enable size/hash validation checks</div>
                </div>
                <input
                  type="checkbox"
                  checked={checksumVerify}
                  onChange={(e) => setChecksumVerify(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
              </div>

              <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-lg border border-slate-950">
                <div>
                  <div className="font-semibold text-slate-200">Queue Concurrency Limit</div>
                  <div className="text-[10px] text-slate-500">Max active parallel transfers</div>
                </div>
                <select
                  value={maxConcurrency}
                  onChange={(e) => setMaxConcurrency(parseInt(e.target.value))}
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 focus:outline-none"
                >
                  <option value={1}>1 Task</option>
                  <option value={2}>2 Tasks (Recommended)</option>
                  <option value={3}>3 Tasks</option>
                </select>
              </div>

              <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-950 flex flex-col gap-2">
                <span className="font-semibold text-slate-200">Storage Restrictions Guide</span>
                <table className="w-full text-[10px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-500">
                      <th className="py-1">Location</th>
                      <th className="py-1">Write Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-900/50 text-slate-400">
                      <td className="py-1">/sdcard/* (Downloads, DCIM, Documents)</td>
                      <td className="py-1 text-green-400 font-bold">Writeable</td>
                    </tr>
                    <tr className="border-b border-slate-900/50 text-slate-400">
                      <td className="py-1">Android/data (Scoped Storage)</td>
                      <td className="py-1 text-red-400 font-bold">Blocked</td>
                    </tr>
                    <tr className="text-slate-400">
                      <td className="py-1">/system, /data (Root filesystems)</td>
                      <td className="py-1 text-red-400 font-bold">Blocked</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📁 NEW FOLDER MODAL */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 relative">
            <h3 className="text-sm font-bold text-slate-100 mb-3">Create New Folder</h3>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder Name"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2.5 focus:outline-none focus:border-indigo-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsNewFolderOpen(false);
                  setNewFolderName("");
                }}
                className="px-3.5 py-2 hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✏️ RENAME MODAL */}
      {isRenameOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 relative">
            <h3 className="text-sm font-bold text-slate-100 mb-3">Rename Item</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="New Name"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2.5 focus:outline-none focus:border-indigo-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsRenameOpen(false);
                  setRenameValue("");
                }}
                className="px-3.5 py-2 hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white cursor-pointer"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
