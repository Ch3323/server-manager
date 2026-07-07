"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Editor from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import axios from "axios";
import {
    AudioLines,
    FileArchive,
    FileCode2,
    FileImage,
    FilePenLine,
    FileSpreadsheet,
    FileText,
    FileType,
    FileVideoCamera,
    FolderOpen,
    MoreHorizontal,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Trash2,
    Upload,
} from "lucide-react";

import { getErrorMessage, showErrorToast, showSuccessToast } from "@/lib/client-notify";
import { Badge } from "@/components/ui/badge";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type FileType = "file" | "directory";
type FilterMode = "all" | "directory" | "file";

interface FileEntry {
    name: string;
    path: string;
    type: FileType;
    size: number;
    modifiedAt: string;
}

type UploadItem = {
    file: File;
    relativePath?: string;
};

type UploadStatus = "queued" | "uploading" | "completed" | "failed";

type UploadProgressItem = {
    id: string;
    file: File;
    relativePath: string;
    uploadedBytes: number;
    size: number;
    status: UploadStatus;
    errorMessage?: string;
};

type EntryContextMenuState = {
    entry: FileEntry;
    x: number;
    y: number;
};

type FileChunk = {
    index: number;
    offset: number;
    size: number;
};

const DEFAULT_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_SIZE = 32 * 1024 * 1024;
const MIN_UPLOAD_CHUNK_SIZE = 256 * 1024;
const UPLOAD_CHUNK_SIZE_STORAGE_KEY = "server-manager.upload.chunk-size";

function clampUploadChunkSize(value: number) {
    if (!Number.isFinite(value)) {
        return DEFAULT_UPLOAD_CHUNK_SIZE;
    }

    return Math.min(MAX_UPLOAD_CHUNK_SIZE, Math.max(MIN_UPLOAD_CHUNK_SIZE, Math.floor(value)));
}

function joinPath(base: string, name: string) {
    if (!base) return name;
    return `${base}/${name}`;
}

function getParentPath(target: string) {
    if (!target) return "";
    const parts = target.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
}

function getBaseName(target: string) {
    const parts = target.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? target;
}

function formatBytes(bytes: number) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDate(value: string) {
    return new Date(value).toLocaleString();
}

function formatPercent(value: number) {
    return `${Math.max(0, Math.min(100, value)).toFixed(value >= 10 ? 0 : 1)}%`;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFileChunks(fileSize: number, chunkSize: number) {
    const chunks: FileChunk[] = [];
    if (fileSize === 0) {
        return chunks;
    }

    for (let offset = 0, index = 0; offset < fileSize; offset += chunkSize, index += 1) {
        chunks.push({
            index,
            offset,
            size: Math.min(chunkSize, fileSize - offset),
        });
    }

    return chunks;
}

function getFileExtension(fileName: string) {
    const name = fileName.toLowerCase();
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === name.length - 1) return "";
    return name.slice(dotIndex + 1);
}

function getEntryVisual(entry: FileEntry) {
    if (entry.type === "directory") {
        return {
            Icon: FolderOpen,
            toneClass: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
        };
    }

    const extension = getFileExtension(entry.name);

    if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "yml", "yaml", "xml", "sql", "sh", "ps1"].includes(extension)) {
        return {
            Icon: FileCode2,
            toneClass: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
        };
    }

    if (["md", "txt", "log", "rtf"].includes(extension)) {
        return {
            Icon: FileText,
            toneClass: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
        };
    }

    if (["csv", "xls", "xlsx"].includes(extension)) {
        return {
            Icon: FileSpreadsheet,
            toneClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        };
    }

    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(extension)) {
        return {
            Icon: FileImage,
            toneClass: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
        };
    }

    if (["mp4", "mov", "webm", "mkv", "avi"].includes(extension)) {
        return {
            Icon: FileVideoCamera,
            toneClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
        };
    }

    if (["mp3", "wav", "ogg", "flac", "m4a"].includes(extension)) {
        return {
            Icon: AudioLines,
            toneClass: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
        };
    }

    if (["zip", "rar", "7z", "gz", "tar", "tgz"].includes(extension)) {
        return {
            Icon: FileArchive,
            toneClass: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        };
    }

    if (["pdf", "doc", "docx", "ppt", "pptx"].includes(extension)) {
        return {
            Icon: FileType,
            toneClass: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
        };
    }

    return {
        Icon: FileText,
        toneClass: "bg-muted text-foreground",
    };
}

function inferLanguage(filePath: string) {
    const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (["ts", "tsx"].includes(extension)) return "typescript";
    if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
    if (extension === "json") return "json";
    if (extension === "md") return "markdown";
    if (extension === "css") return "css";
    if (extension === "html") return "html";
    if (["yml", "yaml"].includes(extension)) return "yaml";
    if (extension === "xml") return "xml";
    if (extension === "sql") return "sql";
    if (extension === "sh") return "shell";
    if (extension === "ps1") return "powershell";
    if (extension === "dockerfile") return "dockerfile";
    return "plaintext";
}

export default function FilesPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const role = session?.user.role;
    const canAccessFiles = role === "ADMIN" || role === "MOD";
    const canManageFiles = role === "ADMIN";
    const isFileManagerReadOnly = role === "MOD";

    const [rootName, setRootName] = useState("workspace");
    const [currentPath, setCurrentPath] = useState("");
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    const [search, setSearch] = useState("");
    const [filterMode, setFilterMode] = useState<FilterMode>("all");

    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createType, setCreateType] = useState<FileType>("file");
    const [createName, setCreateName] = useState("");

    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
    const [renameName, setRenameName] = useState("");

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

    const [editorDialogOpen, setEditorDialogOpen] = useState(false);
    const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
    const [editorFileName, setEditorFileName] = useState("");
    const [editorContent, setEditorContent] = useState("");
    const [initialEditorContent, setInitialEditorContent] = useState("");
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [isSavingFile, setIsSavingFile] = useState(false);
    const monacoEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const filePickerRef = useRef<HTMLInputElement | null>(null);
    const folderPickerRef = useRef<HTMLInputElement | null>(null);
    const dragClientYRef = useRef<number | null>(null);
    const autoScrollFrameRef = useRef<number | null>(null);
    const activeUploadControllersRef = useRef(new Set<AbortController>());
    const activeUploadSessionsRef = useRef(new Map<string, string>());
    const cancelUploadRequestedRef = useRef(false);
    const preferredChunkSizeRef = useRef(DEFAULT_UPLOAD_CHUNK_SIZE);
    const pendingUploadProgressRef = useRef(new Map<string, number>());
    const pendingUploadProgressFrameRef = useRef<number | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadQueue, setUploadQueue] = useState<UploadProgressItem[]>([]);
    const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
    const [entryContextMenu, setEntryContextMenu] = useState<EntryContextMenuState | null>(null);
    const [draggingEntryPath, setDraggingEntryPath] = useState<string | null>(null);
    const [dragOverDirectoryPath, setDragOverDirectoryPath] = useState<string | null>(null);

    const isEditorDirty = useMemo(
        () => editorContent !== initialEditorContent,
        [editorContent, initialEditorContent]
    );
    const editorLineCount = useMemo(() => (editorContent ? editorContent.split("\n").length : 1), [editorContent]);
    const editorCharCount = editorContent.length;
    const draggingEntry = useMemo(
        () => entries.find((entry) => entry.path === draggingEntryPath) ?? null,
        [entries, draggingEntryPath]
    );
    const totalUploadBytes = useMemo(
        () => uploadQueue.reduce((sum, item) => sum + item.size, 0),
        [uploadQueue]
    );
    const uploadedBytes = useMemo(
        () => uploadQueue.reduce((sum, item) => sum + Math.min(item.uploadedBytes, item.size), 0),
        [uploadQueue]
    );
    const overallUploadProgress = totalUploadBytes > 0 ? (uploadedBytes / totalUploadBytes) * 100 : 0;
    const currentUploadItem = useMemo(
        () => uploadQueue.find((item) => item.status === "uploading")
            ?? uploadQueue.find((item) => item.status === "queued")
            ?? uploadQueue[uploadQueue.length - 1]
            ?? null,
        [uploadQueue]
    );

    useEffect(() => {
        if (typeof window === "undefined") return;

        const storedChunkSize = Number(window.localStorage.getItem(UPLOAD_CHUNK_SIZE_STORAGE_KEY) ?? Number.NaN);
        if (Number.isFinite(storedChunkSize)) {
            preferredChunkSizeRef.current = clampUploadChunkSize(storedChunkSize);
        }
    }, []);

    useEffect(() => {
        return () => {
            if (pendingUploadProgressFrameRef.current !== null) {
                cancelAnimationFrame(pendingUploadProgressFrameRef.current);
                pendingUploadProgressFrameRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!draggingEntryPath) {
            dragClientYRef.current = null;
            if (autoScrollFrameRef.current !== null) {
                cancelAnimationFrame(autoScrollFrameRef.current);
                autoScrollFrameRef.current = null;
            }
            return;
        }

        const edgeThreshold = 90;
        const tick = () => {
            const pointerY = dragClientYRef.current;
            if (typeof pointerY === "number") {
                const viewportHeight = window.innerHeight;
                let delta = 0;

                if (pointerY < edgeThreshold) {
                    delta = -Math.ceil((edgeThreshold - pointerY) / 4);
                } else if (pointerY > viewportHeight - edgeThreshold) {
                    delta = Math.ceil((pointerY - (viewportHeight - edgeThreshold)) / 4);
                }

                if (delta !== 0) {
                    window.scrollBy({ top: delta });
                }
            }

            autoScrollFrameRef.current = requestAnimationFrame(tick);
        };

        autoScrollFrameRef.current = requestAnimationFrame(tick);

        return () => {
            if (autoScrollFrameRef.current !== null) {
                cancelAnimationFrame(autoScrollFrameRef.current);
                autoScrollFrameRef.current = null;
            }
        };
    }, [draggingEntryPath]);

    const filteredEntries = useMemo(() => {
        const keyword = search.trim().toLowerCase();

        return [...entries]
            .filter((entry) => {
                const matchesKeyword =
                    keyword.length === 0 ||
                    entry.name.toLowerCase().includes(keyword) ||
                    entry.path.toLowerCase().includes(keyword);

                if (!matchesKeyword) return false;
                if (filterMode === "all") return true;
                return entry.type === filterMode;
            })
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }, [entries, filterMode, search]);

    const breadcrumbs = useMemo(() => currentPath.split("/").filter(Boolean), [currentPath]);

    async function loadDirectory(path: string) {
        setIsLoadingList(true);

        try {
            const res = await axios.get("/api/files/list", {
                params: { path },
            });
            const nextEntries = (res.data.entries ?? []) as FileEntry[];
            const nextCurrentPath = (res.data.currentPath ?? "") as string;

            setRootName(res.data.rootName ?? "workspace");
            setCurrentPath(nextCurrentPath);
            setEntries(nextEntries);
            setHasLoadedOnce(true);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                if (err.response?.status === 403) {
                    showErrorToast(err, "Access denied for this directory");
                } else if (err.response?.status === 404) {
                    showErrorToast(err, "Directory not found");
                } else {
                    showErrorToast(err, "Failed to load directory");
                }
            } else {
                showErrorToast(err, "Failed to load directory");
            }
        } finally {
            setIsLoadingList(false);
        }
    }

    useEffect(() => {
        if (status === "loading") return;
        if (!session) {
            router.push("/auth/login");
            return;
        }
        if (!canAccessFiles) {
            router.push("/dashboard");
            return;
        }
        if (hasLoadedOnce) return;

        const timer = setTimeout(() => {
            void loadDirectory("");
        }, 0);

        return () => clearTimeout(timer);
    }, [session, status, router, hasLoadedOnce, canAccessFiles]);

    async function openFile(entry: FileEntry) {
        if (isEditorDirty) {
            const shouldContinue = window.confirm("You have unsaved changes. Discard them and open another file?");
            if (!shouldContinue) return;
        }

        setEditorDialogOpen(true);
        setIsLoadingFile(true);

        try {
            const res = await axios.get("/api/files/read", {
                params: { path: entry.path },
            });
            const content = res.data.content ?? "";
            setEditorFilePath(entry.path);
            setEditorFileName(entry.name);
            setEditorContent(content);
            setInitialEditorContent(content);
        } catch (err) {
            console.error(err);
            showErrorToast(err, "Failed to open file");
        } finally {
            setIsLoadingFile(false);
        }
    }

    async function saveCurrentFile(nextContent?: string) {
        if (!editorFilePath || !canManageFiles) return;

        const contentToSave = nextContent ?? editorContent;

        setIsSavingFile(true);

        try {
            await axios.post("/api/files/write", {
                path: editorFilePath,
                content: contentToSave,
            });
            setEditorContent(contentToSave);
            setInitialEditorContent(contentToSave);
            showSuccessToast("File saved");
            await loadDirectory(currentPath);
        } catch (err) {
            console.error(err);
            showErrorToast(err, "Failed to save file");
        } finally {
            setIsSavingFile(false);
        }
    }

    function closeEditor(open: boolean) {
        if (!open && isEditorDirty) {
            const shouldClose = window.confirm("You have unsaved changes. Close editor and discard changes?");
            if (!shouldClose) return;
        }
        setEditorDialogOpen(open);
    }

    function handleMonacoMount(
        editor: Monaco.editor.IStandaloneCodeEditor,
        monaco: typeof import("monaco-editor")
    ) {
        monacoEditorRef.current = editor;
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (!canManageFiles) return;
            const latestContent = editor.getValue();
            setEditorContent(latestContent);
            void saveCurrentFile(latestContent);
        });
    }

    async function openEntry(entry: FileEntry) {
        if (entry.type === "directory") {
            await loadDirectory(entry.path);
            return;
        }
        await openFile(entry);
    }

    function canDropIntoDirectory(directoryPath: string) {
        if (!draggingEntryPath) return false;
        if (draggingEntryPath === directoryPath) return false;
        if (
            draggingEntry?.type === "directory" &&
            (directoryPath === draggingEntry.path || directoryPath.startsWith(`${draggingEntry.path}/`))
        ) {
            return false;
        }
        return true;
    }

    function updateOpenEditorPathAfterMove(fromPath: string, toPath: string) {
        if (!editorFilePath) return;
        if (editorFilePath === fromPath) {
            setEditorFilePath(toPath);
            setEditorFileName(getBaseName(toPath));
            return;
        }
        if (editorFilePath.startsWith(`${fromPath}/`)) {
            const suffix = editorFilePath.slice(fromPath.length + 1);
            const nextPath = `${toPath}/${suffix}`;
            setEditorFilePath(nextPath);
            setEditorFileName(getBaseName(nextPath));
        }
    }

    async function moveEntryToDirectory(fromPath: string, directoryPath: string) {
        if (!canManageFiles) return;

        const nextPath = joinPath(directoryPath, getBaseName(fromPath));
        if (nextPath === fromPath) return;

        try {
            await axios.post("/api/files/rename", {
                fromPath,
                toPath: nextPath,
            });
            updateOpenEditorPathAfterMove(fromPath, nextPath);
            showSuccessToast("Moved successfully");
            await loadDirectory(currentPath);
        } catch (err) {
            console.error(err);
            showErrorToast(err, "Failed to move item");
        } finally {
            setDraggingEntryPath(null);
            setDragOverDirectoryPath(null);
        }
    }

    function toUploadItems(fileCollection: FileList | File[]) {
        return Array.from(fileCollection).map((file) => {
            const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
            return {
                file,
                relativePath: webkitPath && webkitPath.trim().length > 0 ? webkitPath : undefined,
            } as UploadItem;
        });
    }

    async function readEntriesRecursively(directory: FileSystemDirectoryEntry) {
        const reader = directory.createReader();
        const allEntries: FileSystemEntry[] = [];

        while (true) {
            const batch = await new Promise<FileSystemEntry[]>((resolve) => {
                reader.readEntries((entries) => resolve(entries));
            });
            if (batch.length === 0) break;
            allEntries.push(...batch);
        }

        return allEntries;
    }

    async function collectUploadItemsFromEntry(entry: FileSystemEntry, parentPath = ""): Promise<UploadItem[]> {
        if (entry.isFile) {
            const file = await new Promise<File>((resolve) => {
                (entry as FileSystemFileEntry).file((resolvedFile) => resolve(resolvedFile));
            });
            const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
            return [{ file, relativePath }];
        }
        if (!entry.isDirectory) {
            return [];
        }

        const nextParent = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        const children = await readEntriesRecursively(entry as FileSystemDirectoryEntry);
        const nested = await Promise.all(children.map((child) => collectUploadItemsFromEntry(child, nextParent)));
        return nested.flat();
    }

    async function extractUploadItemsFromDrop(event: React.DragEvent<HTMLDivElement>) {
        const items = Array.from(event.dataTransfer.items ?? []);
        const entries = items
            .map((item) => {
                const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
                return entry ?? null;
            })
            .filter((entry): entry is FileSystemEntry => entry !== null);

        if (entries.length === 0) {
            return toUploadItems(event.dataTransfer.files);
        }

        const nested = await Promise.all(entries.map((entry) => collectUploadItemsFromEntry(entry)));
        return nested.flat();
    }

    function updateUploadQueueItem(id: string, updater: (item: UploadProgressItem) => UploadProgressItem) {
        setUploadQueue((current) => current.map((item) => (item.id === id ? updater(item) : item)));
    }

    function flushPendingUploadProgress() {
        pendingUploadProgressFrameRef.current = null;

        if (pendingUploadProgressRef.current.size === 0) {
            return;
        }

        const nextProgress = new Map(pendingUploadProgressRef.current);
        pendingUploadProgressRef.current.clear();

        setUploadQueue((current) => current.map((item) => {
            const uploadedBytes = nextProgress.get(item.id);
            if (typeof uploadedBytes !== "number") {
                return item;
            }

            return {
                ...item,
                uploadedBytes: Math.min(uploadedBytes, item.size),
            };
        }));
    }

    function scheduleUploadProgressUpdate(id: string, uploadedBytes: number) {
        pendingUploadProgressRef.current.set(id, uploadedBytes);

        if (pendingUploadProgressFrameRef.current !== null) {
            return;
        }

        pendingUploadProgressFrameRef.current = requestAnimationFrame(() => {
            flushPendingUploadProgress();
        });
    }

    function clearPendingUploadProgress(id?: string) {
        if (typeof id === "string") {
            pendingUploadProgressRef.current.delete(id);
        } else {
            pendingUploadProgressRef.current.clear();
        }

        if (pendingUploadProgressRef.current.size === 0 && pendingUploadProgressFrameRef.current !== null) {
            cancelAnimationFrame(pendingUploadProgressFrameRef.current);
            pendingUploadProgressFrameRef.current = null;
        }
    }

    function rememberPreferredChunkSize(chunkSize: number) {
        const normalizedChunkSize = clampUploadChunkSize(chunkSize);
        preferredChunkSizeRef.current = normalizedChunkSize;

        if (typeof window !== "undefined") {
            window.localStorage.setItem(UPLOAD_CHUNK_SIZE_STORAGE_KEY, String(normalizedChunkSize));
        }
    }

    function shouldRetryUpload(error: unknown) {
        if (!axios.isAxiosError(error)) {
            return true;
        }

        const status = error.response?.status;
        if (!status) {
            return true;
        }

        return status === 408 || status === 425 || status === 429 || status >= 500;
    }

    function isChunkTooLargeError(error: unknown) {
        return axios.isAxiosError(error) && error.response?.status === 413;
    }

    function getRetryDelayMs(error: unknown, attempt: number) {
        if (axios.isAxiosError(error)) {
            const retryAfterHeader = error.response?.headers?.["retry-after"];
            const retryAfterSeconds = Number(retryAfterHeader);
            if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
                return retryAfterSeconds * 1000;
            }
        }

        return Math.min(1500 * 2 ** (attempt - 1), 10_000);
    }

    function isUploadCancelledError(error: unknown) {
        return axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError");
    }

    async function abortUpload(uploadId: string) {
        if (!canManageFiles) return;

        try {
            await axios.post("/api/files/upload", {
                action: "abort",
                uploadId,
            });
        } catch (err) {
            console.error(err);
        }
    }

    async function cancelActiveUploads() {
        cancelUploadRequestedRef.current = true;
        clearPendingUploadProgress();

        const controllers = Array.from(activeUploadControllersRef.current);
        activeUploadControllersRef.current.clear();
        controllers.forEach((controller) => controller.abort());

        const sessionEntries = Array.from(activeUploadSessionsRef.current.entries());
        activeUploadSessionsRef.current.clear();

        await Promise.allSettled(
            sessionEntries.map(([, uploadId]) => abortUpload(uploadId))
        );
    }

    async function uploadSingleFile(queueItem: UploadProgressItem) {
        const maxChunkAttempts = 3;
        let uploadId = "";
        let requestedChunkSize = preferredChunkSizeRef.current;

        while (true) {
            try {
                if (cancelUploadRequestedRef.current) {
                    return {
                        ok: false as const,
                        path: queueItem.relativePath,
                        cancelled: true as const,
                    };
                }

                updateUploadQueueItem(queueItem.id, (item) => ({
                    ...item,
                    status: "uploading",
                    uploadedBytes: 0,
                    errorMessage: undefined,
                }));

                const initRes = await axios.post("/api/files/upload", {
                    action: "init",
                    directoryPath: currentPath,
                    relativePath: queueItem.relativePath,
                    fileName: queueItem.file.name,
                    size: queueItem.size,
                    chunkSize: requestedChunkSize,
                });

                uploadId = String(initRes.data.uploadId ?? "");
                activeUploadSessionsRef.current.set(queueItem.id, uploadId);
                const chunkSize = Number(initRes.data.chunkSize ?? requestedChunkSize);

                if (!uploadId || !Number.isFinite(chunkSize) || chunkSize <= 0) {
                    throw new Error("Upload session could not be created");
                }

                const chunks = createFileChunks(queueItem.size, chunkSize);
                const chunkProgress = new Map<number, number>();
                const completedChunks = new Set<number>();

                const syncUploadedBytes = () => {
                    let nextUploadedBytes = 0;

                    for (const chunk of chunks) {
                        if (completedChunks.has(chunk.index)) {
                            nextUploadedBytes += chunk.size;
                            continue;
                        }

                        nextUploadedBytes += Math.min(chunkProgress.get(chunk.index) ?? 0, chunk.size);
                    }

                    scheduleUploadProgressUpdate(queueItem.id, nextUploadedBytes);
                };

                const uploadChunk = async (chunkInfo: FileChunk) => {
                    for (let attempt = 1; attempt <= maxChunkAttempts; attempt += 1) {
                        if (cancelUploadRequestedRef.current) {
                            throw new DOMException("Upload cancelled", "AbortError");
                        }

                        const controller = new AbortController();
                        activeUploadControllersRef.current.add(controller);

                        try {
                            const chunkBlob = queueItem.file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.size);

                            await axios.put(
                                `/api/files/upload?uploadId=${encodeURIComponent(uploadId)}&offset=${chunkInfo.offset}`,
                                chunkBlob,
                                {
                                    headers: {
                                        "Content-Type": "application/octet-stream",
                                    },
                                    signal: controller.signal,
                                    onUploadProgress: (event) => {
                                        if (completedChunks.has(chunkInfo.index)) {
                                            return;
                                        }

                                        chunkProgress.set(
                                            chunkInfo.index,
                                            Math.min(event.loaded ?? chunkInfo.size, chunkInfo.size)
                                        );
                                        syncUploadedBytes();
                                    },
                                }
                            );

                            completedChunks.add(chunkInfo.index);
                            chunkProgress.delete(chunkInfo.index);
                            clearPendingUploadProgress(queueItem.id);
                            updateUploadQueueItem(queueItem.id, (item) => ({
                                ...item,
                                errorMessage: undefined,
                            }));
                            syncUploadedBytes();
                            return;
                        } catch (err) {
                            chunkProgress.delete(chunkInfo.index);
                            syncUploadedBytes();

                            if (cancelUploadRequestedRef.current || isUploadCancelledError(err)) {
                                throw err;
                            }

                            if (isChunkTooLargeError(err)) {
                                throw err;
                            }

                            const canRetry = attempt < maxChunkAttempts && shouldRetryUpload(err);
                            if (canRetry) {
                                const retryDelayMs = getRetryDelayMs(err, attempt);
                                updateUploadQueueItem(queueItem.id, (item) => ({
                                    ...item,
                                    errorMessage: `Retrying chunk ${chunkInfo.index + 1}/${chunks.length} in ${Math.ceil(retryDelayMs / 1000)}s`,
                                }));
                                await sleep(retryDelayMs);
                                continue;
                            }

                            throw err;
                        } finally {
                            activeUploadControllersRef.current.delete(controller);
                        }
                    }
                };

                const pendingChunks = [...chunks];
                const chunkConcurrency = Math.min(4, pendingChunks.length || 1);

                const worker = async () => {
                    while (pendingChunks.length > 0) {
                        const nextChunk = pendingChunks.shift();
                        if (!nextChunk) {
                            return;
                        }

                        await uploadChunk(nextChunk);
                    }
                };

                await Promise.all(Array.from({ length: chunkConcurrency }, () => worker()));

                await axios.post("/api/files/upload", {
                    action: "complete",
                    uploadId,
                }).then((response) => {
                    const completedSize = Number(response.data?.size ?? Number.NaN);
                    const verified = response.data?.verified === true;

                    if (!verified || completedSize !== queueItem.size) {
                        throw new Error(`Upload verification failed for ${queueItem.relativePath}`);
                    }
                });
                activeUploadSessionsRef.current.delete(queueItem.id);
                clearPendingUploadProgress(queueItem.id);
                rememberPreferredChunkSize(chunkSize);

                updateUploadQueueItem(queueItem.id, (item) => ({
                    ...item,
                    uploadedBytes: item.size,
                    status: "completed",
                    errorMessage: undefined,
                }));

                return {
                    ok: true as const,
                    path: queueItem.relativePath,
                };
            } catch (err) {
                activeUploadSessionsRef.current.delete(queueItem.id);
                clearPendingUploadProgress(queueItem.id);

                if (cancelUploadRequestedRef.current || isUploadCancelledError(err)) {
                    updateUploadQueueItem(queueItem.id, (item) => ({
                        ...item,
                        status: "failed",
                        errorMessage: "Upload cancelled",
                    }));

                    return {
                        ok: false as const,
                        path: queueItem.relativePath,
                        cancelled: true as const,
                    };
                }

                if (uploadId) {
                    await abortUpload(uploadId);
                    uploadId = "";
                }

                if (isChunkTooLargeError(err) && requestedChunkSize > MIN_UPLOAD_CHUNK_SIZE) {
                    requestedChunkSize = clampUploadChunkSize(
                        Math.max(MIN_UPLOAD_CHUNK_SIZE, Math.floor(requestedChunkSize / 2))
                    );
                    updateUploadQueueItem(queueItem.id, (item) => ({
                        ...item,
                        status: "queued",
                        uploadedBytes: 0,
                        errorMessage: `Chunk too large, retrying with ${formatBytes(requestedChunkSize)} chunks`,
                    }));
                    continue;
                }

                const errorMessage = axios.isAxiosError(err) && err.response?.status === 409
                    ? `${queueItem.relativePath} (already exists or upload conflict)`
                    : getErrorMessage(err, `Failed to upload ${queueItem.relativePath}`);

                updateUploadQueueItem(queueItem.id, (item) => ({
                    ...item,
                    status: "failed",
                    errorMessage,
                }));

                return {
                    ok: false as const,
                    path: queueItem.relativePath,
                    errorMessage,
                };
            }
        }
    }

    async function uploadFiles(uploadItems: UploadItem[]) {
        if (!canManageFiles) return;
        if (uploadItems.length === 0) return;

        cancelUploadRequestedRef.current = false;
        setIsUploading(true);
        const queuedItems: UploadProgressItem[] = uploadItems.map((uploadItem) => ({
            id: crypto.randomUUID(),
            file: uploadItem.file,
            relativePath: uploadItem.relativePath ?? uploadItem.file.name,
            uploadedBytes: 0,
            size: uploadItem.file.size,
            status: "queued",
        }));

        setUploadQueue(queuedItems);

        const queue = [...queuedItems];
        const results: Array<
            | { ok: true; path: string }
            | { ok: false; path: string; cancelled: true }
            | { ok: false; path: string; errorMessage: string }
        > = [];
        const concurrency = Math.min(4, queue.length);

        const worker = async () => {
            while (queue.length > 0) {
                if (cancelUploadRequestedRef.current) return;
                const nextItem = queue.shift();
                if (!nextItem) return;
                const result = await uploadSingleFile(nextItem);
                results.push(result);
            }
        };

        try {
            await Promise.all(Array.from({ length: concurrency }, () => worker()));
            if (!cancelUploadRequestedRef.current) {
                await loadDirectory(currentPath);
            }
        } finally {
            clearPendingUploadProgress();
            activeUploadControllersRef.current.clear();
            activeUploadSessionsRef.current.clear();
            setIsDragOver(false);
            setIsUploading(false);
        }

        if (cancelUploadRequestedRef.current) {
            setUploadQueue([]);
            showSuccessToast("Upload cancelled");
            cancelUploadRequestedRef.current = false;
            return;
        }

        const uploaded = results.filter((result) => result.ok).map((result) => result.path);
        const failed = results
            .filter((result): result is { ok: false; path: string; errorMessage: string } => !result.ok && "errorMessage" in result)
            .map((result) => result.errorMessage);

        if (uploaded.length > 0 && failed.length === 0) {
            showSuccessToast(`Uploaded ${uploaded.length} file(s)`);
        } else if (uploaded.length > 0 && failed.length > 0) {
            showSuccessToast(`Uploaded ${uploaded.length} file(s), failed ${failed.length} file(s)`);
            showErrorToast(
                new Error(`Failed: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? "..." : ""}`),
                `Failed: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? "..." : ""}`
            );
        } else {
            showErrorToast(
                new Error(`Upload failed: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? "..." : ""}`),
                `Upload failed: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? "..." : ""}`
            );
        }

        setUploadQueue([]);
    }

    async function handleCreate() {
        if (!canManageFiles) return;

        const trimmed = createName.trim();
        if (!trimmed) return;

        try {
            const nextPath = joinPath(currentPath, trimmed);
            if (createType === "file") {
                await axios.post("/api/files/create", { path: nextPath });
            } else {
                await axios.post("/api/files/mkdir", { path: nextPath });
            }

            setCreateDialogOpen(false);
            setCreateName("");
            const message = `${createType === "file" ? "File" : "Folder"} created`;
            showSuccessToast(message);
            await loadDirectory(currentPath);
        } catch (err) {
            console.error(err);
            showErrorToast(err, `Failed to create ${createType}`);
        }
    }

    async function handleRename() {
        if (!canManageFiles) return;
        if (!renameTarget) return;
        const trimmed = renameName.trim();
        if (!trimmed) return;

        try {
            const parent = getParentPath(renameTarget.path);
            const toPath = joinPath(parent, trimmed);
            await axios.post("/api/files/rename", {
                fromPath: renameTarget.path,
                toPath,
            });

            if (editorFilePath === renameTarget.path) {
                setEditorFilePath(toPath);
                setEditorFileName(trimmed);
            }

            setRenameDialogOpen(false);
            setRenameTarget(null);
            showSuccessToast("Renamed successfully");
            await loadDirectory(currentPath);
        } catch (err) {
            console.error(err);
            showErrorToast(err, "Failed to rename");
        }
    }

    async function handleDelete() {
        if (!canManageFiles) return;
        if (!deleteTarget) return;

        try {
            await axios.post("/api/files/delete", { path: deleteTarget.path });

            if (editorFilePath === deleteTarget.path) {
                setEditorDialogOpen(false);
                setEditorFilePath(null);
                setEditorFileName("");
                setEditorContent("");
                setInitialEditorContent("");
            }

            setDeleteDialogOpen(false);
            setDeleteTarget(null);
            showSuccessToast("Deleted successfully");
            await loadDirectory(currentPath);
        } catch (err) {
            console.error(err);
            showErrorToast(err, "Failed to delete");
        }
    }

    function openRenameDialog(entry: FileEntry) {
        if (!canManageFiles) return;

        setRenameTarget(entry);
        setRenameName(entry.name);
        setRenameDialogOpen(true);
    }

    function openDeleteDialog(entry: FileEntry) {
        if (!canManageFiles) return;

        setDeleteTarget(entry);
        setDeleteDialogOpen(true);
    }

    function closeEntryContextMenu() {
        setEntryContextMenu(null);
    }

    function handleActionMenuOpenChange(menuId: string, open: boolean) {
        if (open) {
            setOpenActionMenuId(menuId);
            closeEntryContextMenu();
            return;
        }

        setOpenActionMenuId((current) => (current === menuId ? null : current));
    }

    function renderEntryActionItems(entry: FileEntry, onAction?: () => void) {
        return (
            <>
                <DropdownMenuItem
                    onClick={() => {
                        onAction?.();
                        void openEntry(entry);
                    }}
                >
                    {entry.type === "directory" ? (
                        <FolderOpen className="h-4 w-4" />
                    ) : (
                        <FileText className="h-4 w-4" />
                    )}
                    Open
                </DropdownMenuItem>
                {canManageFiles ? (
                    <>
                        <DropdownMenuItem
                            onClick={() => {
                                onAction?.();
                                openRenameDialog(entry);
                            }}
                        >
                            <Pencil className="h-4 w-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                                onAction?.();
                                openDeleteDialog(entry);
                            }}
                        >
                            <Trash2 className="h-4 w-4" />
                            Delete
                        </DropdownMenuItem>
                    </>
                ) : null}
            </>
        );
    }

    if (status === "loading" || (!hasLoadedOnce && isLoadingList)) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <Spinner className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">Loading file manager...</p>
                </div>
            </div>
        );
    }

    if (!session || !canAccessFiles) return null;

    return (
        <div className="p-4 md:p-8 space-y-6">
            <div className="container mx-auto flex max-w-7xl flex-col gap-4">
                <Card>
                    <CardHeader className="gap-4">
                        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                            <div className="space-y-3">
                                <div>
                                    <CardTitle className="text-2xl">File Manager</CardTitle>
                                    <CardDescription className="mt-1">
                                        {canManageFiles
                                            ? "Browse and manage files in this workspace."
                                            : "Browse files in this workspace."}
                                    </CardDescription>
                                </div>
                                <Breadcrumb>
                                    <BreadcrumbList>
                                        <BreadcrumbItem>
                                            <BreadcrumbLink asChild>
                                                <button className="cursor-pointer" onClick={() => void loadDirectory("")} type="button">
                                                    {rootName}
                                                </button>
                                            </BreadcrumbLink>
                                        </BreadcrumbItem>
                                        {breadcrumbs.map((segment, index) => {
                                            const path = breadcrumbs.slice(0, index + 1).join("/");
                                            const isLast = index === breadcrumbs.length - 1;

                                            return (
                                                <Fragment key={path}>
                                                    <BreadcrumbSeparator />
                                                    <BreadcrumbItem>
                                                        {isLast ? (
                                                            <BreadcrumbPage>{segment}</BreadcrumbPage>
                                                        ) : (
                                                            <BreadcrumbLink asChild>
                                                                <button className="cursor-pointer" onClick={() => void loadDirectory(path)} type="button">
                                                                    {segment}
                                                                </button>
                                                            </BreadcrumbLink>
                                                        )}
                                                    </BreadcrumbItem>
                                                </Fragment>
                                            );
                                        })}
                                    </BreadcrumbList>
                                </Breadcrumb>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Badge className="max-w-3xs" variant="outline">
                                    <span dir="rtl" className="truncate">
                                        {currentPath ? `${rootName}/${currentPath}` : `${rootName}/`}
                                    </span>
                                </Badge>
                                {isFileManagerReadOnly ? (
                                    <Badge variant="secondary">View only</Badge>
                                ) : null}
                                <Button
                                    variant="outline"
                                    onClick={() => void loadDirectory(currentPath)}
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    Refresh
                                </Button>
                                {canManageFiles ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            disabled={isUploading}
                                            onClick={() => filePickerRef.current?.click()}
                                        >
                                            {isUploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                                            Upload Files
                                        </Button>
                                        <Button
                                            variant="outline"
                                            disabled={isUploading}
                                            onClick={() => folderPickerRef.current?.click()}
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                            Upload Folder
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                setCreateType("file");
                                                setCreateName("");
                                                setCreateDialogOpen(true);
                                            }}
                                        >
                                            <Plus className="h-4 w-4" />
                                            New File
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setCreateType("directory");
                                                setCreateName("");
                                                setCreateDialogOpen(true);
                                            }}
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                            New Folder
                                        </Button>
                                    </>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="relative w-full lg:max-w-sm">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    className="pl-9"
                                    placeholder="Search this folder..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant={filterMode === "all" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setFilterMode("all")}
                                >
                                    All
                                </Button>
                                <Button
                                    variant={filterMode === "directory" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setFilterMode("directory")}
                                >
                                    Folders
                                </Button>
                                <Button
                                    variant={filterMode === "file" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setFilterMode("file")}
                                >
                                    Files
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent>
                        <input
                            ref={filePickerRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                if (!event.target.files) return;
                                void uploadFiles(toUploadItems(event.target.files));
                                event.target.value = "";
                            }}
                        />
                        <input
                            ref={folderPickerRef}
                            type="file"
                            multiple
                            className="hidden"
                            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                            onChange={(event) => {
                                if (!event.target.files) return;
                                void uploadFiles(toUploadItems(event.target.files));
                                event.target.value = "";
                            }}
                        />
                        <Dialog open={uploadQueue.length > 0}>
                            <DialogContent
                                className="w-[min(24rem,calc(100%-2rem))] gap-3 overflow-hidden"
                                showCloseButton={false}
                                onInteractOutside={(event) => event.preventDefault()}
                                onEscapeKeyDown={(event) => event.preventDefault()}
                            >
                                <DialogHeader>
                                    <DialogTitle>Uploading files</DialogTitle>
                                    <DialogDescription className="max-w-full break-all whitespace-normal">
                                        {currentUploadItem?.relativePath ?? "Preparing upload..."}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="min-w-0 space-y-2">
                                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full rounded-full bg-primary transition-[width]"
                                            style={{ width: `${overallUploadProgress}%` }}
                                        />
                                    </div>
                                <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                                        <span className="min-w-0 break-all whitespace-normal">{formatBytes(uploadedBytes)} / {formatBytes(totalUploadBytes)}</span>
                                        <span className="shrink-0">{formatPercent(overallUploadProgress)}</span>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            void cancelActiveUploads();
                                        }}
                                    >
                                        Cancel Upload
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <DropdownMenu
                            modal={false}
                            open={entryContextMenu !== null}
                            onOpenChange={(open) => {
                                if (!open) {
                                    closeEntryContextMenu();
                                }
                            }}
                        >
                            <DropdownMenuTrigger asChild>
                                <button
                                    aria-hidden="true"
                                    className="fixed h-0 w-0 opacity-0 pointer-events-none"
                                    style={{
                                        left: entryContextMenu?.x ?? 0,
                                        top: entryContextMenu?.y ?? 0,
                                    }}
                                    type="button"
                                />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="w-44"
                                sideOffset={2}
                                onCloseAutoFocus={(event) => event.preventDefault()}
                            >
                                {entryContextMenu ? renderEntryActionItems(entryContextMenu.entry, closeEntryContextMenu) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <div
                            className="relative"
                            onDragEnter={(event) => {
                                if (!canManageFiles) return;
                                event.preventDefault();
                                dragClientYRef.current = event.clientY;
                                if (draggingEntryPath) return;
                                setIsDragOver(true);
                            }}
                            onDragOver={(event) => {
                                if (!canManageFiles) return;
                                event.preventDefault();
                                dragClientYRef.current = event.clientY;
                                if (draggingEntryPath) return;
                                setIsDragOver(true);
                            }}
                            onDragLeave={(event) => {
                                if (!canManageFiles) return;
                                const nextTarget = event.relatedTarget as Node | null;
                                if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                                if (draggingEntryPath) return;
                                setIsDragOver(false);
                            }}
                            onDrop={(event) => {
                                if (!canManageFiles) return;
                                event.preventDefault();
                                dragClientYRef.current = null;
                                if (draggingEntryPath) {
                                    setDragOverDirectoryPath(null);
                                    setDraggingEntryPath(null);
                                    return;
                                }
                                setIsDragOver(false);
                                void (async () => {
                                    const uploadItems = await extractUploadItemsFromDrop(event);
                                    await uploadFiles(uploadItems);
                                })();
                            }}
                        >
                            <div className="overflow-hidden rounded-lg border">
                                <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_190px_56px] items-center gap-3 bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground md:grid">
                                    <span>Name</span>
                                    <span>Size</span>
                                    <span>Modified</span>
                                    <span className="text-right">More</span>
                                </div>

                                <div className="divide-y">
                                    {filteredEntries.length === 0 ? (
                                        <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                                            No files found in this view.
                                        </div>
                                    ) : (
                                        filteredEntries.map((entry) => {
                                            const { Icon, toneClass } = getEntryVisual(entry);
                                            const isDraggingRow = draggingEntryPath === entry.path;
                                            const isDropTarget =
                                                entry.type === "directory" &&
                                                dragOverDirectoryPath === entry.path &&
                                                canDropIntoDirectory(entry.path);

                                            return (
                                                <div
                                                    key={entry.path}
                                                    className={`bg-background transition hover:bg-muted/50 ${isDraggingRow ? "opacity-45" : ""
                                                        } ${isDropTarget ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}`}
                                                    draggable={canManageFiles && !isUploading}
                                                    onContextMenu={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setOpenActionMenuId(null);
                                                        setEntryContextMenu({
                                                            entry,
                                                            x: event.clientX,
                                                            y: event.clientY,
                                                        });
                                                    }}
                                                    onDragStart={(event) => {
                                                        if (!canManageFiles || isUploading) {
                                                            event.preventDefault();
                                                            return;
                                                        }
                                                        setDraggingEntryPath(entry.path);
                                                        dragClientYRef.current = event.clientY;
                                                        event.dataTransfer.effectAllowed = "move";
                                                        event.dataTransfer.setData("application/x-file-entry-path", entry.path);
                                                        event.dataTransfer.setData("text/plain", entry.path);
                                                    }}
                                                    onDragEnd={() => {
                                                        if (!canManageFiles) return;
                                                        setDraggingEntryPath(null);
                                                        setDragOverDirectoryPath(null);
                                                        dragClientYRef.current = null;
                                                    }}
                                                    onDragEnter={(event) => {
                                                        if (!canManageFiles) return;
                                                        if (entry.type !== "directory" || !canDropIntoDirectory(entry.path)) return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        dragClientYRef.current = event.clientY;
                                                        setDragOverDirectoryPath(entry.path);
                                                    }}
                                                    onDragOver={(event) => {
                                                        if (!canManageFiles) return;
                                                        if (entry.type !== "directory" || !canDropIntoDirectory(entry.path)) return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        dragClientYRef.current = event.clientY;
                                                        event.dataTransfer.dropEffect = "move";
                                                        if (dragOverDirectoryPath !== entry.path) {
                                                            setDragOverDirectoryPath(entry.path);
                                                        }
                                                    }}
                                                    onDragLeave={(event) => {
                                                        if (!canManageFiles) return;
                                                        if (entry.type !== "directory") return;
                                                        const nextTarget = event.relatedTarget as Node | null;
                                                        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                                                        if (dragOverDirectoryPath === entry.path) {
                                                            setDragOverDirectoryPath(null);
                                                        }
                                                    }}
                                                    onDrop={(event) => {
                                                        if (!canManageFiles) return;
                                                        if (entry.type !== "directory" || !canDropIntoDirectory(entry.path)) return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        dragClientYRef.current = null;
                                                        const fromPath =
                                                            event.dataTransfer.getData("application/x-file-entry-path") ||
                                                            draggingEntryPath;
                                                        if (!fromPath) return;
                                                        void moveEntryToDirectory(fromPath, entry.path);
                                                    }}
                                                >
                                                    <div className="flex items-start justify-between gap-3 p-4 md:hidden">
                                                        <button
                                                            className="min-w-0 flex-1 text-left"
                                                            onDoubleClick={() => void openEntry(entry)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter") {
                                                                    void openEntry(entry);
                                                                }
                                                            }}
                                                            type="button"
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <span
                                                                    className={`rounded-md p-2 ${toneClass}`}
                                                                >
                                                                    <Icon className="h-4 w-4" />
                                                                </span>
                                                                <span className="min-w-0">
                                                                    <span className="flex items-center gap-2">
                                                                        <span className="truncate font-medium">{entry.name}</span>
                                                                    </span>
                                                                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                                                                        {entry.path}
                                                                    </span>
                                                                    <span className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                                                        <span>Size: {entry.type === "directory" ? "--" : formatBytes(entry.size)}</span>
                                                                        <span className="truncate">Updated: {formatDate(entry.modifiedAt)}</span>
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </button>

                                                        <DropdownMenu
                                                            modal={false}
                                                            open={openActionMenuId === `mobile:${entry.path}`}
                                                            onOpenChange={(open) => handleActionMenuOpenChange(`mobile:${entry.path}`, open)}
                                                        >
                                                            <DropdownMenuTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                >
                                                                    <MoreHorizontal className="h-4 w-4" />
                                                                    <span className="sr-only">Open actions</span>
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent
                                                                align="end"
                                                                className="w-44"
                                                                onCloseAutoFocus={(event) => event.preventDefault()}
                                                            >
                                                                {renderEntryActionItems(entry)}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>

                                                    <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_190px_56px] items-center gap-3 px-4 py-3 md:grid">
                                                        <button
                                                            className="col-span-3 grid min-w-0 grid-cols-[minmax(0,1.5fr)_110px_190px] items-center gap-3 text-left"
                                                            onDoubleClick={() => void openEntry(entry)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter") {
                                                                    void openEntry(entry);
                                                                }
                                                            }}
                                                            type="button"
                                                        >
                                                            <span className="flex min-w-0 items-center gap-3">
                                                                <span
                                                                    className={`rounded-md p-2 ${toneClass}`}
                                                                >
                                                                    <Icon className="h-4 w-4" />
                                                                </span>
                                                                <span className="min-w-0">
                                                                    <span className="flex items-center gap-2">
                                                                        <span className="truncate font-medium">{entry.name}</span>
                                                                    </span>
                                                                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                                                        {entry.path}
                                                                    </span>
                                                                </span>
                                                            </span>

                                                            <span className="text-sm text-muted-foreground">
                                                                {entry.type === "directory" ? "--" : formatBytes(entry.size)}
                                                            </span>

                                                            <span className="text-sm text-muted-foreground">{formatDate(entry.modifiedAt)}</span>
                                                        </button>

                                                        <div className="flex justify-end">
                                                            <DropdownMenu
                                                                modal={false}
                                                                open={openActionMenuId === `desktop:${entry.path}`}
                                                                onOpenChange={(open) => handleActionMenuOpenChange(`desktop:${entry.path}`, open)}
                                                            >
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon-sm"
                                                                    >
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                        <span className="sr-only">Open actions</span>
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent
                                                                    align="end"
                                                                    className="w-44"
                                                                    onCloseAutoFocus={(event) => event.preventDefault()}
                                                                >
                                                                    {renderEntryActionItems(entry)}
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                {isLoadingList ? (
                                    <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                                        Loading directory...
                                    </div>
                                ) : null}
                            </div>
                            {canManageFiles ? (
                                <div
                                    className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-dashed border-2 border-primary bg-primary/10 transition-all duration-200 ${isDragOver ? "opacity-100 scale-100" : "opacity-0 scale-95"
                                        }`}
                                >
                                    <div className="rounded-md bg-transparent px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-transform duration-200">
                                        <Upload className="h-16 w-16" />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={editorDialogOpen} onOpenChange={closeEditor}>
                <DialogContent className="sm:max-w-6xl" showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FilePenLine className="h-4 w-4" />
                            {editorFileName || "File Editor"}
                        </DialogTitle>
                        <DialogDescription className="break-all">
                            {editorFilePath ? `${rootName}/${editorFilePath}` : "Open a file from Drive View"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                                {editorLineCount} lines | {editorCharCount} chars
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {canManageFiles ? (
                                    <>
                                        {isEditorDirty ? (
                                            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                                                Unsaved
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline">Saved</Badge>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setEditorContent(initialEditorContent)}
                                            disabled={!isEditorDirty || isSavingFile || isLoadingFile}
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            Reset
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => void saveCurrentFile()}
                                            disabled={!editorFilePath || !isEditorDirty || isSavingFile || isLoadingFile}
                                        >
                                            {isSavingFile ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                            Save
                                        </Button>
                                    </>
                                ) : (
                                    <Badge variant="secondary">View only</Badge>
                                )}
                            </div>
                        </div>

                        {isLoadingFile ? (
                            <div className="flex min-h-105 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
                                Loading file...
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-lg border">
                                <Editor
                                    height="500px"
                                    language={editorFilePath ? inferLanguage(editorFilePath) : "plaintext"}
                                    value={editorContent}
                                    onChange={(value) => {
                                        if (canManageFiles) {
                                            setEditorContent(value ?? "");
                                        }
                                    }}
                                    onMount={handleMonacoMount}
                                    theme="vs-dark"
                                    options={{
                                        automaticLayout: true,
                                        minimap: { enabled: true },
                                        wordWrap: "on",
                                        tabSize: 2,
                                        insertSpaces: true,
                                        fontSize: 13,
                                        smoothScrolling: true,
                                        scrollBeyondLastLine: false,
                                        renderWhitespace: "selection",
                                        bracketPairColorization: { enabled: true },
                                        glyphMargin: true,
                                        folding: true,
                                        lineNumbers: "on",
                                        formatOnPaste: true,
                                        readOnly: !canManageFiles,
                                    }}
                                />
                            </div>
                        )}
                        {!isLoadingFile && !editorFilePath ? (
                            <p className="text-xs text-muted-foreground">
                                Open a file from the table to start editing.
                            </p>
                        ) : null}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => closeEditor(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Create {createType === "file" ? "File" : "Folder"}</DialogTitle>
                        <DialogDescription>
                            Path: {rootName}/{currentPath || ""}
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={createName}
                        onChange={(event) => setCreateName(event.target.value)}
                        placeholder={createType === "file" ? "new-file.txt" : "new-folder"}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => void handleCreate()} disabled={createName.trim().length === 0}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Rename</DialogTitle>
                        <DialogDescription>{renameTarget?.name}</DialogDescription>
                    </DialogHeader>
                    <Input value={renameName} onChange={(event) => setRenameName(event.target.value)} />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => void handleRename()} disabled={renameName.trim().length === 0}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Confirm Delete</DialogTitle>
                        <DialogDescription>
                            Delete <span className="font-medium">{deleteTarget?.name}</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => void handleDelete()}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
