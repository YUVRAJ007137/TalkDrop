import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Room, ChatMessage, MessageStatus, parseMessagePayload, makeTextMessage, makeFileMessage } from '../types';
import { supabase } from '../lib/supabaseClient';
import { fetchReadReceipts, upsertReadReceipt } from '../lib/api';

function createClientId(): string {
	return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractClientId(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed?.clientId === 'string' ? parsed.clientId : undefined;
	} catch {
		return undefined;
	}
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
	return [...list].sort((a, b) => {
		const timeA = new Date(a.timestamp ?? 0).getTime();
		const timeB = new Date(b.timestamp ?? 0).getTime();
		if (timeA === timeB) return a.id - b.id;
		return timeA - timeB;
	});
}
import { createRoom, deleteRoom, fetchMessages, fetchRoomByName, fetchRooms, sendMessage, subscribeToRoomMessages, uploadFile } from '../lib/api';

function Onboard({ onSet }: { onSet: (name: string) => void }) {
	const [name, setName] = useState('');
	return (
		<div className="onboard">
			<h1>TalkDrop</h1>
			<small>Enter a username to start. No signup required.</small>
			<div className="row">
				<input placeholder="Your username" value={name} onChange={(e) => setName(e.target.value)} />
				<button className="button" onClick={() => name.trim() && onSet(name.trim())}>Continue</button>
			</div>
		</div>
	);
}

function RoomsSidebar({ rooms, joinedIds, activeRoomId, onSelect, onCreate, onDelete, onLeave, onClose, onJoin, isOpen, username, onLogout }: {
	rooms: Room[];
	joinedIds: number[];
	activeRoomId: number | null;
	onSelect: (room: Room) => void;
	onCreate: (name: string, password?: string | null) => void;
	onDelete: (roomId: number) => void;
	onLeave: (roomId: number) => void;
	onClose: () => void;
	onJoin: (room: Room) => void;
	isOpen: boolean;
	username: string;
	onLogout: () => void;
}) {
	const [roomName, setRoomName] = useState('');
	const [password, setPassword] = useState('');
	const [joinName, setJoinName] = useState('');
	const [joinPassword, setJoinPassword] = useState('');
	const visibleRooms = rooms.filter((r) => joinedIds.includes(r.id));
	return (
		<div className={`sidebar ${isOpen ? 'open' : ''}`}>
			<div className="header" style={{ gap: 8 }}>
				<span>{username}</span>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<button className="button secondary" onClick={onLogout} aria-label="Logout">Logout</button>
					<button className="button secondary mobile-only" onClick={onClose} aria-label="Close rooms">Close</button>
				</div>
			</div>
			<div className="rooms">
				{visibleRooms.length === 0 && <div className="empty">You haven't joined any rooms yet</div>}
				{visibleRooms.map((r) => (
					<div key={r.id} className={`room-item ${activeRoomId === r.id ? 'active' : ''}`} onClick={() => { onSelect(r); onClose(); }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
							<span>{r.password ? '🔒 ' : ''}{r.room_name}</span>
							<div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
								<button className="button secondary" onClick={() => onLeave(r.id)} aria-label="Remove from my menu">Remove</button>
								<button className="button danger" onClick={() => onDelete(r.id)} aria-label="Delete room">Delete</button>
							</div>
						</div>
					</div>
				))}
			</div>
			<div style={{ padding: 12, background: 'var(--wa-panel-light, var(--panel-light))', display: 'grid', gap: 8 }}>
				<strong>Join room</strong>
				<input placeholder="Room name" value={joinName} onChange={(e) => setJoinName(e.target.value)} />
				<input placeholder="Password (if any)" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} />
				<button className="button" onClick={() => { if (!joinName.trim()) return; onJoin({ id: -1, room_name: joinName.trim(), password: joinPassword.trim() || null } as Room); setJoinName(''); setJoinPassword(''); }}>Join</button>
				<hr style={{ borderColor: '#1f2c33', width: '100%' }} />
				<strong>Create room</strong>
				<input placeholder="New room name" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
				<input placeholder="Password (optional)" value={password} onChange={(e) => setPassword(e.target.value)} />
				<button className="button" onClick={() => { if (roomName.trim()) { onCreate(roomName.trim(), password.trim() || null); setRoomName(''); setPassword(''); } }}>Create</button>
			</div>
		</div>
	);
}

function MessageStatusIcon({ status }: { status?: MessageStatus }) {
	if (!status) return null;
	if (status === 'sending') {
		return (
			<span className="tick-icon" aria-label="Message sending">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M5 13.5l3.5 3.5L19 6.5" stroke="var(--wa-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		);
	}
	const color = status === 'seen' ? '#53bdeb' : 'var(--wa-muted)';
	return (
		<span className={`tick-icon ${status}`} aria-label={status === 'seen' ? 'Message seen' : 'Message delivered'}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M4 13.5l3.5 3.5L15.5 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M9.5 13.5l3.5 3.5L21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</span>
	);
}

function MessageBubble({ me, msg }: { me: string; msg: ChatMessage }) {
	const payload = useMemo(() => parseMessagePayload(msg.message), [msg.message]);
	const isSelf = msg.username === me;
	const rawTs = msg.timestamp ?? Date.now();
	const normalizedDate = typeof rawTs === 'string'
		? new Date(rawTs.endsWith('Z') ? rawTs : rawTs + 'Z')
		: new Date(rawTs);
	const timeIST = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(normalizedDate);
	return (
		<div className={`message ${isSelf ? 'self' : ''}`}>
			<div style={{ fontWeight: 600, marginBottom: 4 }}>{msg.username}</div>
			{payload.kind === 'text' && <div>{payload.text}</div>}
			{payload.kind === 'file' && (
				<div>
					{payload.mime.startsWith('image/') && (
						<img className="file-thumb" src={payload.url} alt={payload.name} />
					)}
					{payload.mime.startsWith('video/') && (
						<video src={payload.url} controls style={{ maxWidth: 320, borderRadius: 8, display: 'block' }} />
					)}
					{payload.mime.startsWith('audio/') && (
						<audio src={payload.url} controls style={{ display: 'block' }} />
					)}
					{payload.mime === 'application/pdf' && (
						<iframe src={payload.url} style={{ width: '100%', maxWidth: 420, height: 360, border: 0, borderRadius: 8 }} />
					)}
					{!payload.mime.startsWith('image/') && !payload.mime.startsWith('video/') && !payload.mime.startsWith('audio/') && payload.mime !== 'application/pdf' && (
						<a className="file-link" href={payload.url} target="_blank" rel="noreferrer noopener" download>{payload.name}</a>
					)}
				</div>
			)}
			<div className="timestamp">
				<span>{timeIST}</span>
				{isSelf && <MessageStatusIcon status={msg.status} />}
			</div>
		</div>
	);
}

function ChatView({ room, me, refreshKey, onOpenRooms, onLogout }: { room: Room; me: string; refreshKey: number; onOpenRooms: () => void; onLogout: () => void }) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [text, setText] = useState('');
	const [pendingFile, setPendingFile] = useState<File | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);
	const endRef = useRef<HTMLDivElement | null>(null);
	const [isNearBottom, setIsNearBottom] = useState<boolean>(true);
	const didInitialScrollRef = useRef<boolean>(false);
	const [isSending, setIsSending] = useState<boolean>(false);
	const [uploadStatus, setUploadStatus] = useState<string>('');
	const shouldScrollAfterSendRef = useRef<boolean>(false);
	const messagesStateRef = useRef<ChatMessage[]>([]);
	const presenceChannelRef = useRef<RealtimeChannel | null>(null);
	const presenceReadyRef = useRef<boolean>(false);
	const pendingPresenceUpdateRef = useRef<number | null>(null);
	const lastSeenMessageIdRef = useRef<number>(0);
	const [presenceMap, setPresenceMap] = useState<Record<string, number>>({});
	const { value: seenByAllUpTo, setValue: setSeenByAllUpTo } = useLocalStorage<number>(`td:room:${room.id}:seenByAllUpTo`, 0);

	function normalizeToDate(raw: string | number | null): Date {
		const rawTs = raw ?? Date.now();
		return typeof rawTs === 'string' ? new Date(rawTs.endsWith('Z') ? rawTs : rawTs + 'Z') : new Date(rawTs);
	}

	function getISTDayKey(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
	}

	function getDayLabelForKey(key: string): string {
		const nowKey = getISTDayKey(new Date());
		const yesterdayKey = getISTDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
		if (key === nowKey) return 'Today';
		if (key === yesterdayKey) return 'Yesterday';
		// Format as D MMM YYYY
		const [y, m, d] = key.split('-').map((s) => parseInt(s, 10));
		const display = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
		return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(display);
	}

	const enhanceIncomingMessage = useCallback((incoming: ChatMessage): ChatMessage => {
		const clientId = extractClientId(incoming.message) ?? incoming.clientId;
		const baseStatus: MessageStatus | undefined =
			incoming.username === me ? incoming.status ?? 'delivered' : incoming.status;
		return { ...incoming, clientId, status: baseStatus };
	}, [me]);

	const mergeIncomingMessage = useCallback((prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] => {
		const enhanced = enhanceIncomingMessage(incoming);
		const clientId = enhanced.clientId;
		if (clientId) {
			const idx = prev.findIndex((msg) => msg.clientId === clientId);
			if (idx !== -1) {
				const existing = prev[idx];
				const mergedStatus: MessageStatus | undefined =
					existing.status === 'seen'
						? 'seen'
						: existing.status === 'sending'
							? 'delivered'
							: enhanced.status ?? existing.status ?? (enhanced.username === me ? 'delivered' : undefined);
				const next = [...prev];
				next[idx] = { ...existing, ...enhanced, status: mergedStatus };
				return sortMessages(next);
			}
		}
		const idxById = prev.findIndex((msg) => msg.id === enhanced.id);
		if (idxById !== -1) {
			const existing = prev[idxById];
			const mergedStatus: MessageStatus | undefined =
				existing.status === 'seen'
					? 'seen'
					: existing.status === 'sending'
						? 'delivered'
						: enhanced.status ?? existing.status ?? (enhanced.username === me ? 'delivered' : undefined);
			const next = [...prev];
			next[idxById] = { ...existing, ...enhanced, status: mergedStatus };
			return sortMessages(next);
		}
		return sortMessages([...prev, enhanced]);
	}, [enhanceIncomingMessage, me]);

	const updatePresence = useCallback((lastSeenId: number) => {
		if (lastSeenId <= 0 || lastSeenId <= lastSeenMessageIdRef.current) {
			return;
		}
		lastSeenMessageIdRef.current = lastSeenId;
		const channel = presenceChannelRef.current;
		if (presenceReadyRef.current && channel) {
			void channel.track({ lastSeenMessageId: lastSeenId });
			pendingPresenceUpdateRef.current = null;
		} else {
			pendingPresenceUpdateRef.current = lastSeenId;
		}
	}, []);

	const markAllAsRead = useCallback(() => {
		const currentMessages = messagesStateRef.current;
		if (!currentMessages.length) return;
		const lastServerMessageId = currentMessages.reduce((max, msg) => (msg.id > 0 ? Math.max(max, msg.id) : max), 0);
		if (lastServerMessageId > 0) {
			updatePresence(lastServerMessageId);
			// Persist to server so read state survives history clears
			void upsertReadReceipt(room.id, me, lastServerMessageId).catch(() => {});
		}
	}, [updatePresence]);

	const applySeenCutoff = useCallback((list: ChatMessage[], cutoffId: number): ChatMessage[] => {
		if (!cutoffId || cutoffId <= 0) return list;
		let changed = false;
		const next = list.map((msg) => {
			if (msg.username !== me) return msg;
			if (msg.status === 'seen') return msg;
			if (msg.id > 0 && msg.id <= cutoffId) {
				changed = true;
				return { ...msg, status: 'seen' as MessageStatus };
			}
			return msg;
		});
		return changed ? next : list;
	}, [me]);

	useEffect(() => {
		let mounted = true;
		fetchMessages(room.id).then((list) => {
			if (!mounted) return;
			setMessages((prev) => {
				const mapped = list.map((msg) => enhanceIncomingMessage(msg));
				let next = [...prev];
				for (const msg of mapped) {
					next = mergeIncomingMessage(next, msg);
				}
				next = sortMessages(next);
				// Apply persisted seen cutoff so blue ticks remain after refresh
				next = applySeenCutoff(next, seenByAllUpTo);
				return next;
			});
		});
		// Fetch server receipts and derive a conservative "seen by all" cutoff from other participants
		fetchReadReceipts(room.id)
			.then((receipts) => {
				const others = receipts.filter((r) => r.username !== me);
				if (!others.length) return;
				const minSeenByOthers = Math.min(...others.map((r) => r.last_seen_message_id ?? 0));
				if (minSeenByOthers > 0 && minSeenByOthers > (seenByAllUpTo ?? 0)) {
					setSeenByAllUpTo(minSeenByOthers);
					setMessages((prev) => applySeenCutoff(prev, minSeenByOthers));
				}
			})
			.catch(() => {});
		const unsub = subscribeToRoomMessages(room.id, (incoming) => {
			setMessages((prev) => {
				const merged = mergeIncomingMessage(prev, incoming);
				return applySeenCutoff(merged, seenByAllUpTo);
			});
		});
		return () => { mounted = false; unsub(); };
	}, [room.id, refreshKey, enhanceIncomingMessage, mergeIncomingMessage, applySeenCutoff, seenByAllUpTo]);

	// When switching rooms or forcing refresh, ensure we reset and do the initial jump-to-bottom again
	useEffect(() => {
		setMessages([]); // clear to avoid cross-room residue
		didInitialScrollRef.current = false;
		setIsNearBottom(true);
		lastSeenMessageIdRef.current = 0;
		pendingPresenceUpdateRef.current = null;
		messagesStateRef.current = [];
	}, [room.id, refreshKey]);

	useEffect(() => {
		// On first load after messages arrive, jump to bottom instantly
		if (!didInitialScrollRef.current && endRef.current) {
			endRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
			didInitialScrollRef.current = true;
			return;
		}
		// On subsequent updates, scroll only if user is near bottom or we just sent a message
		if (shouldScrollAfterSendRef.current || isNearBottom) {
			endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
			shouldScrollAfterSendRef.current = false;
		}
	}, [messages.length, isNearBottom]);

	useEffect(() => {
		messagesStateRef.current = messages;
	}, [messages]);

	useEffect(() => {
		if (isNearBottom) {
			markAllAsRead();
		}
	}, [isNearBottom, markAllAsRead, messages.length]);

	useEffect(() => {
		const channel = supabase.channel(`room:${room.id}:presence`, {
			config: { presence: { key: me } }
		});
		presenceChannelRef.current = channel;
		presenceReadyRef.current = false;
		setPresenceMap({});
		channel.on('presence', { event: 'sync' }, () => {
			const state = channel.presenceState() as Record<string, Array<{ lastSeenMessageId?: number }>>;
			const next: Record<string, number> = {};
			for (const [user, sessions] of Object.entries(state)) {
				const max = sessions.reduce((acc, session) => Math.max(acc, session.lastSeenMessageId ?? 0), 0);
				next[user] = max;
			}
			setPresenceMap(next);
		});
		void channel.subscribe(async (status) => {
			if (status === 'SUBSCRIBED') {
				presenceReadyRef.current = true;
				const initial = lastSeenMessageIdRef.current;
				await channel.track({ lastSeenMessageId: initial });
				if (pendingPresenceUpdateRef.current && pendingPresenceUpdateRef.current > initial) {
					const nextValue = pendingPresenceUpdateRef.current;
					pendingPresenceUpdateRef.current = null;
					lastSeenMessageIdRef.current = nextValue;
					await channel.track({ lastSeenMessageId: nextValue });
				}
			}
		});
		return () => {
			presenceReadyRef.current = false;
			pendingPresenceUpdateRef.current = null;
			presenceChannelRef.current = null;
			setPresenceMap({});
			channel.unsubscribe();
		};
	}, [room.id, me]);

	useEffect(() => {
		if (!Object.keys(presenceMap).length) return;
		setMessages((prev) => {
			let changed = false;
			const next = prev.map((msg) => {
				if (msg.username !== me || msg.status === 'seen' || msg.id <= 0) return msg;
				const others = Object.entries(presenceMap).filter(([user]) => user !== me);
				if (!others.length) return msg;
				const seen = others.every(([, lastSeen]) => (lastSeen ?? 0) >= msg.id);
				if (!seen) return msg;
				changed = true;
				return { ...msg, status: 'seen' as MessageStatus };
			});
			// Persist minimal seen cutoff to keep blue ticks after refresh
			const others = Object.entries(presenceMap).filter(([user]) => user !== me);
			if (others.length) {
				const minSeenByOthers = Math.min(...others.map(([, v]) => v ?? 0));
				if (minSeenByOthers > 0 && minSeenByOthers > (seenByAllUpTo ?? 0)) {
					setSeenByAllUpTo(minSeenByOthers);
				}
			}
			return changed ? next : prev;
		});
	}, [presenceMap, me, seenByAllUpTo, setSeenByAllUpTo]);

	async function handleSend() {
		const trimmed = text.trim();
		if (!trimmed && !pendingFile) return;
		if (trimmed || pendingFile) {
			shouldScrollAfterSendRef.current = true;
		}
		if (trimmed) {
			const clientId = createClientId();
			const payload = makeTextMessage(trimmed, clientId);
			const optimisticId = -Math.floor(Date.now() + Math.random() * 1000);
			const optimisticMessage: ChatMessage = {
				id: optimisticId,
				room_id: room.id,
				username: me,
				message: payload,
				timestamp: new Date().toISOString(),
				status: 'sending',
				clientId
			};
			setMessages((prev) => sortMessages([...prev, optimisticMessage]));
			try {
				await sendMessage(room.id, me, payload);
				setMessages((prev) =>
					prev.map((msg) => (msg.clientId === clientId && msg.status === 'sending' ? { ...msg, status: 'delivered' } : msg))
				);
			} catch (err) {
				console.error('Failed to send message:', err);
				setMessages((prev) => prev.filter((msg) => msg.clientId !== clientId));
				window.alert(`Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`);
			}
		}
		if (pendingFile) {
			setIsSending(true);
			setUploadStatus('Uploading file...');
			try {
				const timeoutMs = 60000; // 60s safety timeout
				const uploaded = await Promise.race([
					uploadFile(pendingFile),
					new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Upload timed out')), timeoutMs))
				]);
				const clientId = createClientId();
				const payload = makeFileMessage(uploaded.url, uploaded.mime, uploaded.name, clientId);
				await sendMessage(room.id, me, payload);
				setUploadStatus('');
			} catch (err) {
				console.error('Upload failed:', err);
				setUploadStatus('Upload failed');
				window.alert(`File upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			} finally {
				setIsSending(false);
			}
		}
		setText('');
		setPendingFile(null);
		// Ensure we scroll to the newest message after sending
		requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
	}

	function onPickFileClick() {
		fileInputRef.current?.click();
	}

	function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0] ?? null;
		setPendingFile(file);
	}

	function handleMessagesScroll() {
		const el = messagesRef.current;
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		const isBottom = distanceFromBottom < 120;
		setIsNearBottom(isBottom);
		if (isBottom) {
			markAllAsRead();
		}
	}

	return (
		<div className="main">
			<div className="chat-header">
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<button className="icon-button mobile-only" onClick={onOpenRooms} aria-label="Open rooms">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
						</svg>
					</button>
					<span>{room.room_name}</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<button className="button secondary" onClick={onLogout} aria-label="Logout">Logout</button>
				</div>
			</div>
			<div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
				{messages.length === 0 && <div className="empty">Say hi 👋</div>}
				{(() => {
					const items: JSX.Element[] = [];
					let lastKey: string | null = null;
					for (const m of messages) {
						const d = normalizeToDate(m.timestamp ?? null);
						const key = getISTDayKey(d);
						if (key !== lastKey) {
							items.push(
								<div key={`sep-${key}`} className="day-separator">{getDayLabelForKey(key)}</div>
							);
							lastKey = key;
						}
						items.push(<MessageBubble key={m.id} me={me} msg={m} />);
					}
					return items;
				})()}
				<div ref={endRef} />
			</div>
			<div className="input-row">
				<input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileChange} />
				<button className="icon-button" onClick={onPickFileClick} aria-label="Attach file">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 11-7.78-7.78l9.19-9.19a3.5 3.5 0 115 5l-9.19 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
					</svg>
				</button>
				<div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
					{pendingFile && (
						<div className="pending-file">
							<span title={pendingFile.name}>{pendingFile.name}</span>
							<button className="tag-clear" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Remove file">×</button>
						</div>
					)}
					<input type="text" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
				</div>
				<button className="button" onClick={handleSend} disabled={isSending}>Send</button>
			</div>
			{isSending && (
				<div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
					<div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
					{uploadStatus && <div className="text-sm text-[var(--wa-text)] opacity-90">{uploadStatus}</div>}
				</div>
			)}
		</div>
	);
}

export default function App() {
	const { value: username, setValue: setUsername } = useLocalStorage<string>('td:username', '');
	const { value: joinedIds, setValue: setJoinedIds } = useLocalStorage<number[]>('td:unlocked', []);
	const [rooms, setRooms] = useState<Room[]>([]);
	const [activeId, setActiveId] = useState<number | null>(null);
	const [showRooms, setShowRooms] = useState<boolean>(false);
	const [roomRefreshKey, setRoomRefreshKey] = useState<number>(0);

	useEffect(() => {
		let mounted = true;
		fetchRooms().then((r) => { if (!mounted) return; setRooms(r); });
		return () => { mounted = false; };
	}, []);

	async function handleCreate(name: string, password?: string | null) {
		try {
			const room = await createRoom(name, password);
			setRooms((prev) => [room, ...prev]);
			setJoinedIds([...joinedIds, room.id]);
			setActiveId(room.id);
		} catch (err: any) {
			const msg = err?.message || 'Failed to create room';
			window.alert(msg);
		}
	}

	async function handleJoin(request: Room) {
		try {
			const found = await fetchRoomByName(request.room_name);
			if (!found) {
				window.alert('Room not found');
				return;
			}
			if (found.password && found.password !== (request.password ?? '')) {
				window.alert('Incorrect password');
				return;
			}
			if (!rooms.find((r) => r.id === found.id)) setRooms((prev) => [found, ...prev]);
			if (!joinedIds.includes(found.id)) setJoinedIds([...joinedIds, found.id]);
			setActiveId(found.id);
		} catch (err: any) {
			const msg = err?.message || 'Failed to join room';
			window.alert(msg);
		}
	}

	async function handleDelete(roomId: number) {
		try {
			await deleteRoom(roomId);
			setRooms((prev) => prev.filter((r) => r.id !== roomId));
			setJoinedIds(joinedIds.filter((id) => id !== roomId));
			if (activeId === roomId) setActiveId(null);
		} catch (err: any) {
			const msg = err?.message || 'Failed to delete room';
			window.alert(msg);
		}
	}

	function handleLeave(roomId: number) {
		setJoinedIds(joinedIds.filter((id) => id !== roomId));
		if (activeId === roomId) setActiveId(null);
	}

	function handleSelect(room: Room) {
		if (joinedIds.includes(room.id)) {
			if (activeId === room.id) {
				setRoomRefreshKey((v) => v + 1); // force refetch/resubscribe
			} else {
				setActiveId(room.id);
				setRoomRefreshKey((v) => v + 1);
			}
			return;
		}
		window.alert('You are not joined to this room');
	}

	function handleLogout() {
		setUsername('');
		setJoinedIds([]);
		setActiveId(null);
		setShowRooms(false);
	}

	if (!username) {
		return <Onboard onSet={setUsername} />;
	}

	const activeRoom = rooms.find((r) => r.id === activeId) || null;

	return (
		<div className="app">
			<RoomsSidebar
				rooms={rooms}
				joinedIds={joinedIds}
				activeRoomId={activeId}
				onSelect={handleSelect}
				onCreate={handleCreate}
				onDelete={handleDelete}
				onLeave={handleLeave}
				onClose={() => setShowRooms(false)}
				onJoin={handleJoin}
				isOpen={showRooms}
				username={username}
				onLogout={handleLogout}
			/>
			{showRooms && <div className="backdrop" onClick={() => setShowRooms(false)} />}
			{activeRoom ? (
				<ChatView room={activeRoom} me={username} refreshKey={roomRefreshKey} onOpenRooms={() => setShowRooms((v) => !v)} onLogout={handleLogout} />
			) : (
				<div className="main">
					<div className="chat-header">
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<button className="icon-button mobile-only" onClick={() => setShowRooms((v) => !v)} aria-label="Open rooms">
								<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
									<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
								</svg>
							</button>
							<span>TalkDrop</span>
						</div>
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<button className="button secondary" onClick={handleLogout} aria-label="Logout">Logout</button>
						</div>
					</div>
					<div className="empty">Join or create a room</div>
				</div>
			)}
		</div>
	);
} 