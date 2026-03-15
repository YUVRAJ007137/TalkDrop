import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Room, ChatMessage, MessageStatus, parseMessagePayload, makeTextMessage, makeFileMessage, UserPresence } from '../types';
import { supabase } from '../lib/supabaseClient';
import { fetchReadReceipts, upsertReadReceipt, fetchUserMoods, upsertUserMood, fetchMessageById, type ReadReceipt } from '../lib/api';
import { deleteMessage, editMessage } from '../lib/messageEdits';
import { UserPresencePanel } from '../components/UserPresencePanel';
import { MessageActions } from '../components/MessageActions';

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

/** Preview text for a message (reply bar and quote block). */
function getMessageSnippet(msg: ChatMessage): string {
	if (msg.is_deleted) return 'Message deleted';
	const p = parseMessagePayload(msg.message);
	if (p.kind === 'text') return p.text.slice(0, 80);
	return p.name?.slice(0, 40) ?? 'Attachment';
}
import { createRoom, deleteRoom, fetchMessages, fetchRoomById, fetchRoomByName, fetchRooms, sendMessage, subscribeToRoomMessages, uploadFile } from '../lib/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

const ROOM_BASE_URL = (import.meta.env.VITE_APP_PUBLIC_URL as string) || 'https://talk-drop.vercel.app';

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

function MessageBubble({
	me,
	msg,
	allMessages,
	onReply,
	onEdit,
	onDelete
}: {
	me: string;
	msg: ChatMessage;
	allMessages: ChatMessage[];
	onReply?: (messageId: number, username: string, snippet: string) => void;
	onEdit?: (id: number, text: string) => void;
	onDelete?: (id: number) => void;
}) {
	const payload = useMemo(() => parseMessagePayload(msg.message), [msg.message]);
	const isSelf = msg.username === me;
	const rawTs = msg.timestamp ?? Date.now();
	const normalizedDate = typeof rawTs === 'string'
		? new Date(rawTs.endsWith('Z') ? rawTs : rawTs + 'Z')
		: new Date(rawTs);
	const timeIST = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(normalizedDate);
	const replyToMsg = msg.reply_to_id != null ? allMessages.find((m) => m.id === msg.reply_to_id) : null;

	if (msg.is_deleted) {
		return (
			<div className={`message ${isSelf ? 'self' : ''}`} style={{ opacity: 0.5 }}>
				<div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{msg.username}</div>
				<div style={{ fontStyle: 'italic', color: 'var(--wa-muted)' }}>This message was deleted</div>
				<div className="timestamp">
					<span>{timeIST}</span>
				</div>
			</div>
		);
	}

	return (
		<div className={`message ${isSelf ? 'self' : ''}`} style={{ position: 'relative' }}>
			<div style={{ fontWeight: 600, marginBottom: 4 }}>{msg.username}</div>
			{msg.reply_to_id != null && (
				<div
					className="message-reply-quote"
					style={{
						borderLeft: '3px solid var(--wa-accent, #00a884)',
						paddingLeft: 8,
						marginBottom: 6,
						opacity: 0.95
					}}
				>
					<div style={{ fontSize: 12, color: 'var(--wa-muted)', fontWeight: 600 }}>
						{msg.reply_to_username ?? replyToMsg?.username ?? 'Unknown'}
					</div>
					<div style={{ fontSize: 13, color: 'var(--wa-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{replyToMsg ? getMessageSnippet(replyToMsg) : 'Message unavailable'}
					</div>
				</div>
			)}
			{payload.kind === 'text' && (
				<div>
					<div>{payload.text}</div>
					{msg.edited_at && <div style={{ fontSize: 11, color: 'var(--wa-muted)', marginTop: 2 }}>(edited)</div>}
				</div>
			)}
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
			<div className="timestamp" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
				<div>
					<span>{timeIST}</span>
					{isSelf && <MessageStatusIcon status={msg.status} />}
				</div>
				<MessageActions
					messageId={msg.id}
					username={msg.username}
					messageText={payload.kind === 'text' ? (payload as { text: string }).text : ''}
					messageSnippet={getMessageSnippet(msg)}
					isSelf={isSelf}
					editedAt={msg.edited_at}
					onReply={onReply}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
			</div>
		</div>
	);
}

function ChatView({ room, me, refreshKey, onOpenRooms, onLogout, isNewlyCreated, onFirstMessage }: { room: Room; me: string; refreshKey: number; onOpenRooms: () => void; onLogout: () => void; isNewlyCreated?: boolean; onFirstMessage?: () => void }) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const hasNotifiedFirstMessageRef = useRef(false);
	const [text, setText] = useState('');
	const [replyingTo, setReplyingTo] = useState<{ id: number; username: string; snippet: string } | null>(null);
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
	const [userPresence, setUserPresence] = useState<UserPresence[]>([]);
	const [moodMapState, setMoodMapState] = useState<Record<string, string | undefined>>({});
	const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
	const loadingOlderRef = useRef<boolean>(false);
	const PAGE_SIZE = 25;
	const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
	// Keep authoritative server moods separate so presence-derived moods don't override DB
	const serverMoodRef = useRef<Record<string, string | undefined>>({});
	const [readReceipts, setReadReceipts] = useState<ReadReceipt[]>([]);
	const { value: seenByAllUpTo, setValue: setSeenByAllUpTo } = useLocalStorage<number>(`td:room:${room.id}:seenByAllUpTo`, 0);
	const presenceUpdateTimeoutRef = useRef<number | null>(null);
	const presenceActivityTimeoutRef = useRef<Record<string, number>>({});
	const heartbeatIntervalRef = useRef<number | null>(null);
	const localTypingRef = useRef<boolean>(false);
	const typingStopTimeoutRef = useRef<number | null>(null);
	const [typingUsers, setTypingUsers] = useState<string[]>([]);
	// Persist mood per-username so it can be resent when rejoining a room
	const { value: storedMood, setValue: setStoredMood, remove: removeStoredMood } = useLocalStorage<string | null>(`td:username:${me}:mood`, null);
	const [mood, _setMood] = useState<string | null>(storedMood ?? null);
	// pendingMoodRef kept for backward compatibility with earlier local presence buffering; not used when moods are server-side
	const pendingMoodRef = useRef<string | null>(null);

	function setMood(emoji: string | null) {
		_setMood(emoji);
		try { setStoredMood(emoji); } catch { /* ignore */ }
	}
	const [showMoodPicker, setShowMoodPicker] = useState(false);
	const [showQr, setShowQr] = useState(false);

	const MOODS: Array<{ key: string; emoji: string; label: string }> = [
		{ key: 'happy', emoji: '😊', label: 'Happy' },
		{ key: 'sad', emoji: '😢', label: 'Sad' },
		{ key: 'frustrated', emoji: '😤', label: 'Frustrated' },
		{ key: 'romantic', emoji: '😍', label: 'Romantic' },
		{ key: 'angry', emoji: '😠', label: 'Angry' }
	];

	function selectMood(emoji: string) {
		setMood(emoji);
		setShowMoodPicker(false);
		const channel = presenceChannelRef.current;
		if (presenceReadyRef.current && channel) {
			void channel.track({ lastSeenMessageId: lastSeenMessageIdRef.current, typing: localTypingRef.current }).catch(() => {});
		}
		// Persist mood to server so others can fetch authoritative mood when joining
		void upsertUserMood(me, emoji).catch(() => {});
	}

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
			// Track presence immediately to be reflected in presenceMap including typing state
			void channel.track({ lastSeenMessageId: lastSeenId, typing: localTypingRef.current }).catch((err) => {
				console.warn('Failed to update presence:', err);
			});
			pendingPresenceUpdateRef.current = null;
		} else {
			// Buffer update for when presence is ready
			pendingPresenceUpdateRef.current = lastSeenId;
		}
	}, []);

	const startTyping = useCallback(() => {
		if (typingStopTimeoutRef.current !== null) {
			window.clearTimeout(typingStopTimeoutRef.current);
		}
		if (!localTypingRef.current) {
			localTypingRef.current = true;
			// Inform presence channel if ready
			const channel = presenceChannelRef.current;
			if (presenceReadyRef.current && channel) {
				void channel.track({ lastSeenMessageId: lastSeenMessageIdRef.current, typing: true }).catch(() => {});
			}
		}
		// Stop typing after 1.5s of inactivity
		typingStopTimeoutRef.current = window.setTimeout(() => {
			if (localTypingRef.current) {
				localTypingRef.current = false;
				const channel = presenceChannelRef.current;
				if (presenceReadyRef.current && channel) {
					void channel.track({ lastSeenMessageId: lastSeenMessageIdRef.current, typing: false }).catch(() => {});
				}
			}
			typingStopTimeoutRef.current = null;
		}, 1500);
	}, []);

	const stopTypingImmediate = useCallback(() => {
		if (typingStopTimeoutRef.current !== null) {
			window.clearTimeout(typingStopTimeoutRef.current);
			typingStopTimeoutRef.current = null;
		}
		if (localTypingRef.current) {
			localTypingRef.current = false;
			const channel = presenceChannelRef.current;
			if (presenceReadyRef.current && channel) {
				void channel.track({ lastSeenMessageId: lastSeenMessageIdRef.current, typing: false }).catch(() => {});
			}
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
		// initial load: fetch latest `pageSize` messages
		const pageSize = 25;
		fetchMessages(room.id, pageSize).then((list) => {
			if (!mounted) return;
			// list is oldest->newest
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
			// determine if there are more older messages
			if (list.length < pageSize) {
				setHasMoreOlder(false);
			} else {
				setHasMoreOlder(true);
			}
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

	// Subscribe to message UPDATE/DELETE events (edits and deletes)
	useEffect(() => {
		const channel = supabase
			.channel(`room:${room.id}:message-edits`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
				(payload: any) => {
					try {
						const updatedRow = payload.new as ChatMessage | undefined;
						if (updatedRow) {
							setMessages((prev) =>
								prev.map((msg) =>
									msg.id === updatedRow.id ? updatedRow : msg
								)
							);
						}
					} catch (e) {
						// ignore subscription errors
					}
				}
			)
			.subscribe();

		return () => {
			channel.unsubscribe();
		};
	}, [room.id]);

	// When switching rooms or forcing refresh, ensure we reset and do the initial jump-to-bottom again
	useEffect(() => {
		setMessages([]); // clear to avoid cross-room residue
		setReplyingTo(null);
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

	// Reset first-message flag when switching rooms
	useEffect(() => {
		hasNotifiedFirstMessageRef.current = false;
	}, [room.id]);

	// After first message in a newly created room, notify parent so QR is dismissed
	useEffect(() => {
		if (isNewlyCreated && onFirstMessage && messages.length > 0 && !hasNotifiedFirstMessageRef.current) {
			hasNotifiedFirstMessageRef.current = true;
			onFirstMessage();
		}
	}, [isNewlyCreated, onFirstMessage, messages.length]);

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
		let moodsChannel: any = null;
		setPresenceMap({});
		setUserPresence([]);
		presenceActivityTimeoutRef.current = {};
		
		channel.on('presence', { event: 'sync' }, () => {
			// Debounce presence updates to avoid rapid state changes
			if (presenceUpdateTimeoutRef.current !== null) {
				window.clearTimeout(presenceUpdateTimeoutRef.current);
			}
			presenceUpdateTimeoutRef.current = window.setTimeout(() => {
				const state = channel.presenceState() as Record<string, Array<{ lastSeenMessageId?: number }>>;
				const next: Record<string, number> = {};
				const presenceList: UserPresence[] = [];
				const now = Date.now();
				
				for (const [user, sessions] of Object.entries(state)) {
					const max = sessions.reduce((acc, session) => Math.max(acc, session.lastSeenMessageId ?? 0), 0);
					next[user] = max;
					// Update lastActivity to now for online sessions
					presenceActivityTimeoutRef.current[user] = now;
					const isTyping = sessions.some((s) => !!(s as any).typing);
					// collect mood from session metadata if present
					const moodFromSessions = sessions.map((s) => (s as any).mood).filter(Boolean);
					const mood = moodFromSessions.length ? moodFromSessions[moodFromSessions.length - 1] : undefined;
					if (isTyping && user !== me) {
						// we'll aggregate typing users below
					}
					presenceList.push({
						username: user,
						lastSeenMessageId: max,
						lastActivity: presenceActivityTimeoutRef.current[user],
						mood,
						isOnline: true
					});
				}

				// Aggregate typing users from presence state (session metadata may include `typing`)
				const typingNow: string[] = [];
				for (const [user, sessions] of Object.entries(state)) {
					const isTyping = sessions.some((s) => !!(s as any).typing);
					if (isTyping && user !== me) typingNow.push(user);
				}
				// Also extract mood per-user from presence state (last session that included mood)
				const moodMap: Record<string, string | undefined> = {};
				for (const [user, sessions] of Object.entries(state)) {
					const moods = sessions.map((s) => (s as any).mood).filter(Boolean);
					moodMap[user] = moods.length ? moods[moods.length - 1] : undefined;
				}
				setTypingUsers(typingNow);
				setPresenceMap(next);
				// Merge presence-derived moods only for users that don't have a server-stored mood.
				// Server moods are authoritative and updated via the user_moods realtime subscription.
				setMoodMapState((prev) => {
					const merged = { ...(prev ?? {}) } as Record<string, string | undefined>;
					try {
						for (const [u, m] of Object.entries(moodMap)) {
							// if server has a mood for this user, prefer that
							if (serverMoodRef.current && Object.prototype.hasOwnProperty.call(serverMoodRef.current, u)) {
								// ensure merged reflects server mood (may be undefined)
								merged[u] = serverMoodRef.current[u];
								continue;
							}
							// otherwise use presence-derived mood
							merged[u] = m;
							const key = `td:username:${u}:mood`;
							if (m) localStorage.setItem(key, JSON.stringify(m));
							else localStorage.removeItem(key);
						}
					} catch (e) {
						// ignore storage errors
					}
					return merged;
				});
				// Build set of currently-online usernames
				const onlineSet = new Set(Object.keys(next));
				// Merge into userPresence: online users get isOnline=true and lastActivity updated; others preserved but marked offline
				setUserPresence((prev) => {
					const map = new Map<string, import('../types').UserPresence>();
					// start with previous users
					for (const u of prev) map.set(u.username, { ...u, isOnline: onlineSet.has(u.username) });
					// overwrite/add with fresh presenceList entries (ensure latest lastActivity)
					for (const p of presenceList) map.set(p.username, p);
					// ensure users not in onlineSet but present keep their previous lastActivity
					// ensure users not in onlineSet but present keep their previous lastActivity
					return Array.from(map.values()).sort((a, b) => {
						if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
						return b.lastActivity - a.lastActivity;
					});
				});
				presenceUpdateTimeoutRef.current = null;
			}, 300); // 300ms debounce buffer
		});
		
		void channel.subscribe(async (status) => {
				if (status === 'SUBSCRIBED') {
				presenceReadyRef.current = true;
				const initial = lastSeenMessageIdRef.current;
					// When subscribing, do not send mood via presence - moods are server-authoritative
					await channel.track({ lastSeenMessageId: initial, typing: localTypingRef.current });
						// Fetch persisted moods from server for currently-present users and seed local storage
						try {
							const stateNow = channel.presenceState() as Record<string, Array<Record<string, unknown>>>;
							const usernames = Object.keys(stateNow).filter(Boolean);
							if (usernames.length) {
								const serverMoods = await fetchUserMoods(usernames);
								const serverMoodMap: Record<string, string | undefined> = {};
								for (const row of serverMoods) {
									serverMoodMap[row.username] = row.mood ?? undefined;
									const key = `td:username:${row.username}:mood`;
									if (row.mood) localStorage.setItem(key, JSON.stringify(row.mood));
									else localStorage.removeItem(key);
								}
								// store authoritative server moods
								serverMoodRef.current = serverMoodMap;
								setMoodMapState((prev) => ({ ...(prev ?? {}), ...serverMoodMap }));
							}
						} catch (e) {
							// ignore server fetch errors silently
						}
				if (pendingPresenceUpdateRef.current && pendingPresenceUpdateRef.current > initial) {
					const nextValue = pendingPresenceUpdateRef.current;
					pendingPresenceUpdateRef.current = null;
					lastSeenMessageIdRef.current = nextValue;
						await channel.track({ lastSeenMessageId: nextValue, typing: localTypingRef.current });
				}
				// start a heartbeat so the server sees us as online and other clients get timely presence updates
				if (heartbeatIntervalRef.current === null) {
					heartbeatIntervalRef.current = window.setInterval(() => {
						try {
							channel.track({ lastSeenMessageId: lastSeenMessageIdRef.current, typing: localTypingRef.current });
						} catch (e) {
							// ignore
						}
					}, 10000); // every 10s
				}

				// Subscribe to server-side mood changes (user_moods table) so DB changes are authoritative
				moodsChannel = supabase
					.channel('user_moods:listen')
					.on('postgres_changes', { event: '*', schema: 'public', table: 'user_moods' }, (payload: any) => {
						try {
							const newRow = payload.new as { username: string; mood: string | null } | undefined;
							const oldRow = payload.old as { username: string } | undefined;
							if (newRow) {
								// INSERT or UPDATE
								const username = newRow.username;
								const m = newRow.mood ?? undefined;
								serverMoodRef.current = { ...(serverMoodRef.current ?? {}), [username]: m };
								const key = `td:username:${username}:mood`;
								if (m) localStorage.setItem(key, JSON.stringify(m)); else localStorage.removeItem(key);
								setMoodMapState((prev) => ({ ...(prev ?? {}), [username]: m }));
							} else if (oldRow) {
								const username = oldRow.username;
								if (serverMoodRef.current && Object.prototype.hasOwnProperty.call(serverMoodRef.current, username)) {
									delete serverMoodRef.current[username];
								}
								localStorage.removeItem(`td:username:${username}:mood`);
								setMoodMapState((prev) => ({ ...(prev ?? {}), [username]: undefined }));
							}
						} catch (e) {
							// ignore
						}
					})
					.subscribe();
			}
		});
		
		return () => {
			presenceReadyRef.current = false;
			pendingPresenceUpdateRef.current = null;
			if (presenceUpdateTimeoutRef.current !== null) {
				window.clearTimeout(presenceUpdateTimeoutRef.current);
				presenceUpdateTimeoutRef.current = null;
			}
			if (heartbeatIntervalRef.current !== null) {
				window.clearInterval(heartbeatIntervalRef.current);
				heartbeatIntervalRef.current = null;
			}
			// clear any typing timers and inform channel
			stopTypingImmediate();
			presenceChannelRef.current = null;
			setPresenceMap({});
			setUserPresence([]);
			presenceActivityTimeoutRef.current = {};
			// Try to persist the last seen to server so others see an up-to-date lastActivity
			try {
				void upsertReadReceipt(room.id, me, lastSeenMessageIdRef.current).catch(() => {});
			} catch (_) {
				// ignore
			}
			// unsubscribe moods channel if present
			try {
				if (typeof moodsChannel !== 'undefined' && moodsChannel) {
					supabase.removeChannel(moodsChannel);
				}
			} catch (_) {}
			channel.unsubscribe();
		};
	}, [room.id, me]);

	useEffect(() => {
		if (!Object.keys(presenceMap).length) return;
		
		setMessages((prev) => {
			let changed = false;
			const next = prev.map((msg) => {
				if (msg.username !== me || msg.status === 'seen' || msg.id <= 0) return msg;
				
				// Get all other users (excluding self)
				const others = Object.entries(presenceMap).filter(([user]) => user !== me);
				if (!others.length) return msg; // No other users to verify against
				
				// Check if ALL other users have seen this message
				const allSeenIt = others.every(([, lastSeen]) => {
					const lastSeenId = lastSeen ?? 0;
					return lastSeenId >= msg.id;
				});
				
				if (!allSeenIt) return msg;
				
				// Message is seen by all
				changed = true;
				return { ...msg, status: 'seen' as MessageStatus };
			});
			
			// Also update the persisted seen cutoff from other users' presence
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

	// Fetch read receipts (historical last seen) once per room and store them
useEffect(() => {
		let mounted = true;
		fetchReadReceipts(room.id)
			.then((receipts) => { if (!mounted) return; setReadReceipts(receipts); })
			.catch((err) => console.warn('Failed to fetch read receipts:', err));
		return () => { mounted = false; };
	}, [room.id]);

	// Rebuild the userPresence list from presenceMap (online) + readReceipts (historical)
useEffect(() => {
		// Build receipts map for lookup
		const receiptsMap: Record<string, ReadReceipt> = {};
		for (const r of readReceipts) receiptsMap[r.username] = r;
		const onlineUsers = Object.entries(presenceMap);
		// For online users prefer the in-memory presenceActivity timestamp (set during presence sync).
		// Fall back to server receipt updated_at if no presence activity timestamp exists.
		const onlineList: UserPresence[] = onlineUsers.map(([username, lastSeenMessageId]) => ({
			username,
			lastSeenMessageId,
			lastActivity: (presenceActivityTimeoutRef.current && presenceActivityTimeoutRef.current[username])
				? presenceActivityTimeoutRef.current[username]
				: (receiptsMap[username] ? new Date(receiptsMap[username].updated_at ?? Date.now()).getTime() : Date.now()),
			isOnline: true,
			mood: moodMapState[username]
		}));
		// Offline/historical users come from server read receipts. Use a proper membership check
		// so users with a lastSeen of 0 are not treated as absent incorrectly.
		const offlineList: UserPresence[] = readReceipts
			.filter((r) => !(Object.prototype.hasOwnProperty.call(presenceMap, r.username)) && r.username !== me)
			.map((r) => ({
				username: r.username,
				lastSeenMessageId: r.last_seen_message_id,
				lastActivity: new Date(r.updated_at ?? Date.now()).getTime(),
				isOnline: false
			}));
		const merged = [...onlineList, ...offlineList];
		setUserPresence(merged.sort((a, b) => (a.isOnline === b.isOnline ? b.lastActivity - a.lastActivity : (a.isOnline ? -1 : 1))));
	}, [presenceMap, readReceipts, me]);

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
				await sendMessage(room.id, me, payload, replyingTo ? { id: replyingTo.id, username: replyingTo.username } : null);
				setMessages((prev) =>
					prev.map((msg) => (msg.clientId === clientId && msg.status === 'sending' ? { ...msg, status: 'delivered' } : msg))
				);
				setReplyingTo(null);
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
				await sendMessage(room.id, me, payload, replyingTo ? { id: replyingTo.id, username: replyingTo.username } : null);
				setUploadStatus('');
				setReplyingTo(null);
			} catch (err) {
				console.error('Upload failed:', err);
				setUploadStatus('Upload failed');
				window.alert(`File upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
			} finally {
				setIsSending(false);
			}
		}
		setText('');
		// stop typing immediately after send
		stopTypingImmediate();
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

	async function handleDeleteMessage(messageId: number) {
		try {
			await deleteMessage(messageId);
			// Fetch the updated message from the database
			const updatedMsg = await fetchMessageById(messageId);
			if (updatedMsg) {
				setMessages((prev) =>
					prev.map((msg) => (msg.id === messageId ? updatedMsg : msg))
				);
			}
		} catch (err) {
			console.error('Failed to delete message:', err);
			window.alert(`Failed to delete message: ${err instanceof Error ? err.message : 'Unknown error'}`);
		}
	}

	async function handleEditMessage(messageId: number, newText: string) {
		try {
			// preserve the same stored payload format (JSON string) for text messages
			// find the message in local state to extract clientId if present
			const existing = messages.find((m) => m.id === messageId);
			const clientId = existing?.clientId;
			const payload = makeTextMessage(newText, clientId);

			await editMessage(messageId, payload, me);
			// Fetch the updated message from the database
			const updatedMsg = await fetchMessageById(messageId);
			if (updatedMsg) {
				setMessages((prev) =>
					prev.map((msg) => (msg.id === messageId ? updatedMsg : msg))
				);
			}
		} catch (err) {
			console.error('Failed to edit message:', err);
			window.alert(`Failed to edit message: ${err instanceof Error ? err.message : 'Unknown error'}`);
		}
	}

	function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
		setText(e.target.value);
		startTyping();
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

		// If user scrolled near the top, attempt to load older messages
		if (el.scrollTop < 120 && !loadingOlderRef.current && hasMoreOlder) {
			// load older messages
			void (async () => {
				const current = messagesRef.current;
				if (!current) return;
				const oldestId = messages.length ? messages[0].id : undefined;
				if (!oldestId) return;
				loadingOlderRef.current = true;
				setLoadingOlder(true);
				const prevScrollHeight = el.scrollHeight;
				try {
					const older = await fetchMessages(room.id, PAGE_SIZE, oldestId);
					if (!older || older.length === 0) {
						setHasMoreOlder(false);
						loadingOlderRef.current = false;
						setLoadingOlder(false);
						return;
					}
					// map and prepend
					const mapped = older.map((m) => enhanceIncomingMessage(m));
					setMessages((prev) => {
						const next = [...mapped, ...prev];
						return sortMessages(next);
					});
					// if fewer than page size, no more older messages
					if (older.length < PAGE_SIZE) setHasMoreOlder(false);
				} catch (err) {
					console.warn('Failed to load older messages', err);
				} finally {
					loadingOlderRef.current = false;
					setLoadingOlder(false);
					// restore scroll position after prepend
					requestAnimationFrame(() => {
						try {
							const newScrollHeight = el.scrollHeight;
							el.scrollTop = newScrollHeight - prevScrollHeight + el.scrollTop;
						} catch (_) {}
					});
				}
			})();
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
					<span style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
						<span>{room.room_name}</span>
						<button
							type="button"
							className="icon-button"
							aria-label="Copy room link"
							title="Copy room link"
							onClick={() => {
								const url = `${window.location.origin}/room/${room.id}`;
								navigator.clipboard.writeText(url).then(() => { /* optional: toast */ }).catch(() => {});
							}}
							style={{ padding: 6 }}
						>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						</button>
						<button
							type="button"
							className="icon-button"
							aria-label="Show room QR code"
							title="Show room QR code"
							onClick={() => setShowQr((v) => !v)}
							style={{ padding: 6 }}
						>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<rect x="3" y="3" width="7" height="7" />
								<rect x="14" y="3" width="7" height="7" />
								<rect x="3" y="14" width="7" height="7" />
								<path d="M14 14h3v3h-3zM14 17h3" />
							</svg>
						</button>
						{showQr && (
							<>
								<div
									className="backdrop"
									style={{ zIndex: 18 }}
									onClick={() => setShowQr(false)}
									aria-hidden
								/>
								<div
									className="qr-popover"
									style={{
										position: 'absolute',
										left: 0,
										top: 40,
										background: 'var(--wa-panel)',
										padding: 16,
										borderRadius: 12,
										boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
										zIndex: 20,
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										gap: 12
									}}
								>
									<div style={{ fontSize: 13, color: 'var(--wa-muted)', fontWeight: 600 }}>Scan to join room</div>
									<div style={{ background: '#fff', padding: 10, borderRadius: 8 }}>
										<QRCodeSVG value={`${ROOM_BASE_URL}/room/${room.id}`} size={180} level="M" />
									</div>
									<div style={{ fontSize: 11, color: 'var(--wa-muted)', wordBreak: 'break-all', maxWidth: 200 }}>
										{ROOM_BASE_URL}/room/{room.id}
									</div>
									<button type="button" className="button secondary" onClick={() => setShowQr(false)} style={{ fontSize: 12 }}>
									Close
								</button>
								</div>
							</>
						)}
						{/* Mood selector button */}
						<button className="icon-button" aria-label="Select mood" onClick={() => setShowMoodPicker((v) => !v)} style={{ padding: 6 }}>
							<span style={{ fontSize: 18 }}>{mood ?? '🙂'}</span>
						</button>
						{showMoodPicker && (
							<div className="mood-picker" style={{ position: 'absolute', left: 48, top: 36, background: 'var(--wa-panel)', padding: 8, borderRadius: 8, display: 'flex', gap: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.6)' }}>
								{MOODS.map((m) => (
									<button key={m.key} className="icon-button" onClick={() => selectMood(m.emoji)} title={m.label} aria-label={m.label} style={{ padding: 8 }}>
										<span style={{ fontSize: 20 }}>{m.emoji}</span>
									</button>
								))}
							</div>
						)}
					</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
					{/* Show current user's presented mood */}
					{mood && (
						<div className="my-mood" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--wa-muted)', fontSize: 14 }}>
							<span style={{ fontSize: 18 }}>{mood}</span>
							<span style={{ opacity: 0.9 }}>{MOODS.find((m) => m.emoji === mood)?.label ?? 'Mood'}</span>
						</div>
					)}
					<button className="button secondary" onClick={onLogout} aria-label="Logout">Logout</button>
				</div>
			</div>
			<div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
				{loadingOlder && (
					<div className="loading-older" style={{ padding: 8, textAlign: 'center', color: 'var(--wa-muted)' }}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
							<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ display: 'inline-block' }} />
							<span style={{ fontSize: 13 }}>Loading older messages…</span>
						</span>
					</div>
				)}
				{messages.length === 0 && isNewlyCreated && (
					<div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24 }}>
						<div style={{ fontSize: 15, color: 'var(--wa-muted)', fontWeight: 600 }}>Share this QR to invite others</div>
						<div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
							<QRCodeSVG value={`${ROOM_BASE_URL}/room/${room.id}`} size={200} level="M" />
						</div>
						<div style={{ fontSize: 12, color: 'var(--wa-muted)', wordBreak: 'break-all', textAlign: 'center', maxWidth: 260 }}>
							{ROOM_BASE_URL}/room/{room.id}
						</div>
						<div style={{ fontSize: 13, color: 'var(--wa-muted)' }}>Send a message to dismiss</div>
					</div>
				)}
				{messages.length === 0 && !isNewlyCreated && <div className="empty">Say hi 👋</div>}
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
						items.push(
							<MessageBubble
								key={m.id}
								me={me}
								msg={m}
								allMessages={messages}
								onReply={(id, username, snippet) => setReplyingTo({ id, username, snippet })}
								onEdit={handleEditMessage}
								onDelete={handleDeleteMessage}
							/>
						);
					}
					return items;
				})()}
				<div ref={endRef} />
			</div>
			{/* Typing indicator (shows when other participants are typing) */}
			{typingUsers.length > 0 && (
				<div className="typing-indicator" aria-live="polite">
					{typingUsers.length === 1 ? `${typingUsers[0]} is typing...` : `${typingUsers.join(', ')} are typing...`}
				</div>
			)}
			<div className="input-row">
				{replyingTo && (
					<div
						className="reply-preview"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							padding: '6px 10px',
							background: 'var(--wa-panel-light, rgba(255,255,255,0.06))',
							borderRadius: 8,
							marginBottom: 6,
							borderLeft: '3px solid var(--wa-accent, #00a884)'
						}}
					>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ fontSize: 12, color: 'var(--wa-muted)', fontWeight: 600 }}>Replying to {replyingTo.username}</div>
							<div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyingTo.snippet}</div>
						</div>
						<button
							type="button"
							className="icon-button"
							onClick={() => setReplyingTo(null)}
							aria-label="Cancel reply"
							style={{ padding: 4, flexShrink: 0 }}
						>
							×
						</button>
					</div>
				)}
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
					<input type="text" placeholder="Type a message" value={text} onChange={handleInputChange} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
				</div>
				<button className="button" onClick={handleSend} disabled={isSending}>Send</button>
			</div>
			<UserPresencePanel users={userPresence} currentUsername={me} />
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
	const [pendingRoomJoin, setPendingRoomJoin] = useState<{ room: Room } | null>(null);
	const [newlyCreatedRoomId, setNewlyCreatedRoomId] = useState<number | null>(null);
	const navigate = useNavigate();
	const location = useLocation();

	const roomIdFromUrl = (() => {
		const m = location.pathname.match(/^\/room\/(\d+)$/);
		return m ? parseInt(m[1], 10) : null;
	})();

	useEffect(() => {
		let mounted = true;
		fetchRooms().then((r) => { if (!mounted) return; setRooms(r); });
		return () => { mounted = false; };
	}, []);

	// Sync URL to state: set activeId and handle /room/:id (fetch room, join or show password gate)
	useEffect(() => {
		if (roomIdFromUrl === null) {
			setActiveId(null);
			setPendingRoomJoin(null);
			return;
		}
		setActiveId(roomIdFromUrl);
		let cancelled = false;
		(async () => {
			const existing = rooms.find((r) => r.id === roomIdFromUrl);
			if (existing) {
				if (!joinedIds.includes(roomIdFromUrl) && existing.password) {
					if (!cancelled) setPendingRoomJoin({ room: existing });
				} else if (!joinedIds.includes(roomIdFromUrl)) {
					setJoinedIds((prev) => (prev.includes(roomIdFromUrl) ? prev : [...prev, roomIdFromUrl]));
				}
				return;
			}
			const room = await fetchRoomById(roomIdFromUrl);
			if (cancelled) return;
			if (!room) {
				navigate('/', { replace: true });
				return;
			}
			setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [room, ...prev]));
			if (joinedIds.includes(roomIdFromUrl)) return;
			if (room.password) {
				setPendingRoomJoin({ room });
			} else {
				setJoinedIds((prev) => (prev.includes(roomIdFromUrl) ? prev : [...prev, roomIdFromUrl]));
			}
		})();
		return () => { cancelled = true; };
	}, [roomIdFromUrl, location.pathname, rooms, joinedIds]);

	async function handleCreate(name: string, password?: string | null) {
		try {
			const room = await createRoom(name, password);
			setRooms((prev) => [room, ...prev]);
			setJoinedIds((prev) => [...prev, room.id]);
			setNewlyCreatedRoomId(room.id);
			navigate(`/room/${room.id}`);
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
			setRooms((prev) => (prev.some((r) => r.id === found.id) ? prev : [found, ...prev]));
			setJoinedIds((prev) => (prev.includes(found.id) ? prev : [...prev, found.id]));
			setPendingRoomJoin(null);
			navigate(`/room/${found.id}`);
		} catch (err: any) {
			const msg = err?.message || 'Failed to join room';
			window.alert(msg);
		}
	}

	async function handleDelete(roomId: number) {
		try {
			await deleteRoom(roomId);
			setRooms((prev) => prev.filter((r) => r.id !== roomId));
			setJoinedIds((prev) => prev.filter((id) => id !== roomId));
			if (activeId === roomId) {
				setActiveId(null);
				setPendingRoomJoin(null);
				navigate('/', { replace: true });
			}
		} catch (err: any) {
			const msg = err?.message || 'Failed to delete room';
			window.alert(msg);
		}
	}

	function handleLeave(roomId: number) {
		setJoinedIds((prev) => prev.filter((id) => id !== roomId));
		if (activeId === roomId) {
			setActiveId(null);
			setPendingRoomJoin(null);
			navigate('/', { replace: true });
		}
	}

	function handleSelect(room: Room) {
		if (joinedIds.includes(room.id)) {
			setRoomRefreshKey((v) => v + 1);
			navigate(`/room/${room.id}`);
			return;
		}
		window.alert('You are not joined to this room');
	}

	function handleLogout() {
		setUsername('');
		setJoinedIds([]);
		setActiveId(null);
		setPendingRoomJoin(null);
		setShowRooms(false);
		navigate('/', { replace: true });
	}

	if (!username) {
		return <Onboard onSet={setUsername} />;
	}

	const activeRoom = rooms.find((r) => r.id === activeId) || null;

	// Password gate when opening /room/:id and room is password-protected
	if (pendingRoomJoin) {
		const gateRoom = pendingRoomJoin.room;
		return (
			<div className="app">
				<RoomsSidebar
					rooms={rooms}
					joinedIds={joinedIds}
					activeRoomId={null}
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
				<JoinRoomGate
					room={gateRoom}
					onSubmit={(enteredPassword) => handleJoin({ id: gateRoom.id, room_name: gateRoom.room_name, password: enteredPassword.trim() || null } as Room)}
					onCancel={() => { setPendingRoomJoin(null); navigate('/', { replace: true }); }}
				/>
			</div>
		);
	}

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
				<ChatView
					room={activeRoom}
					me={username}
					refreshKey={roomRefreshKey}
					onOpenRooms={() => setShowRooms((v) => !v)}
					onLogout={handleLogout}
					isNewlyCreated={activeId !== null && newlyCreatedRoomId === activeId}
					onFirstMessage={() => setNewlyCreatedRoomId(null)}
				/>
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

function JoinRoomGate({ room, onSubmit, onCancel }: { room: Room; onSubmit: (password: string) => void; onCancel: () => void }) {
	const [password, setPassword] = useState('');
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSubmit(password);
	};
	return (
		<div className="main">
			<div className="chat-header">
				<span>TalkDrop</span>
				<button type="button" className="button secondary" onClick={onCancel} aria-label="Cancel">Cancel</button>
			</div>
			<div style={{ padding: 24, maxWidth: 360, margin: '0 auto' }}>
				<h2 style={{ fontSize: 18, marginBottom: 8 }}>Join room: {room.room_name}</h2>
				<p style={{ color: 'var(--wa-muted)', fontSize: 14, marginBottom: 16 }}>This room is protected. Enter the password to join.</p>
				<form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
					<input
						type="password"
						placeholder="Password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--wa-muted)', background: 'var(--wa-panel)', color: 'var(--wa-text)' }}
						autoFocus
					/>
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="submit" className="button">Join</button>
						<button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
					</div>
				</form>
			</div>
		</div>
	);
} 