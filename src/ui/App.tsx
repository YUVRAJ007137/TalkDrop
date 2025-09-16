import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Room, ChatMessage, parseMessagePayload, makeTextMessage, makeFileMessage } from '../types';
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

function RoomsSidebar({ rooms, joinedIds, activeRoomId, onSelect, onCreate, onDelete, onClose, onJoin, isOpen, username, onLogout }: {
	rooms: Room[];
	joinedIds: number[];
	activeRoomId: number | null;
	onSelect: (room: Room) => void;
	onCreate: (name: string, password?: string | null) => void;
	onDelete: (roomId: number) => void;
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
							<button className="button danger" onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}>Delete</button>
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
			<div className="timestamp">{timeIST}</div>
		</div>
	);
}

function ChatView({ room, me, onOpenRooms, onLogout }: { room: Room; me: string; onOpenRooms: () => void; onLogout: () => void }) {
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

	useEffect(() => {
		let mounted = true;
		fetchMessages(room.id).then((m) => mounted && setMessages(m));
		const unsub = subscribeToRoomMessages(room.id, (m) => setMessages((prev) => [...prev, m]));
		return () => { mounted = false; unsub(); };
	}, [room.id]);

	// When switching rooms, ensure we do the initial jump-to-bottom again
	useEffect(() => {
		didInitialScrollRef.current = false;
		setIsNearBottom(true);
	}, [room.id]);

	useEffect(() => {
		// On first load after messages arrive, jump to bottom instantly
		if (!didInitialScrollRef.current && endRef.current) {
			endRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
			didInitialScrollRef.current = true;
			return;
		}
		// On subsequent updates, scroll only if near bottom or last message is from me
		const last = messages[messages.length - 1];
		if (isNearBottom || (last && last.username === me)) {
			endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}
	}, [messages.length, isNearBottom, me]);

	async function handleSend() {
		const trimmed = text.trim();
		if (!trimmed && !pendingFile) return;
		if (trimmed) {
			await sendMessage(room.id, me, makeTextMessage(trimmed));
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
				await sendMessage(room.id, me, makeFileMessage(uploaded.url, uploaded.mime, uploaded.name));
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
		setIsNearBottom(distanceFromBottom < 120);
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
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<button className="button secondary desktop-only" onClick={onOpenRooms} aria-label="Open rooms">Rooms</button>
					<button className="button secondary mobile-only" onClick={onLogout} aria-label="Logout">Logout</button>
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

	function handleSelect(room: Room) {
		if (joinedIds.includes(room.id)) {
			setActiveId(room.id);
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
				onClose={() => setShowRooms(false)}
				onJoin={handleJoin}
				isOpen={showRooms}
				username={username}
				onLogout={handleLogout}
			/>
			{showRooms && <div className="backdrop" onClick={() => setShowRooms(false)} />}
			{activeRoom ? (
				<ChatView room={activeRoom} me={username} onOpenRooms={() => setShowRooms(true)} onLogout={handleLogout} />
			) : (
				<div className="main">
					<div className="chat-header">
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<button className="icon-button mobile-only" onClick={() => setShowRooms(true)} aria-label="Open rooms">
								<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
									<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
								</svg>
							</button>
							<span>Welcome</span>
						</div>
						<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<button className="button secondary desktop-only" onClick={() => setShowRooms(true)} aria-label="Open rooms">Rooms</button>
							<button className="button secondary mobile-only" onClick={handleLogout} aria-label="Logout">Logout</button>
						</div>
					</div>
					<div className="empty">Join or create a room</div>
				</div>
			)}
		</div>
	);
} 