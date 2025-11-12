import { supabase } from './supabaseClient';
import { ChatMessage, Room } from '../types';

export async function fetchRooms(): Promise<Room[]> {
	const { data, error } = await supabase.from('rooms').select('*').order('id', { ascending: false });
	if (error) throw error;
	return data ?? [];
}

export async function fetchRoomByName(roomName: string): Promise<Room | null> {
	const { data, error } = await supabase.from('rooms').select('*').eq('room_name', roomName).maybeSingle();
	if (error) throw error;
	return data ?? null;
}

export async function createRoom(roomName: string, password?: string | null): Promise<Room> {
	const { data, error } = await supabase
		.from('rooms')
		.insert({ room_name: roomName, password: password ?? null })
		.select('*')
		.single();
	if (error) throw error;
	return data as Room;
}

export async function deleteRoom(roomId: number): Promise<void> {
	const { error } = await supabase.from('rooms').delete().eq('id', roomId);
	if (error) throw error;
}

export async function fetchMessages(roomId: number): Promise<ChatMessage[]> {
	const { data, error } = await supabase
		.from('messages')
		.select('*')
		.eq('room_id', roomId)
		.order('id', { ascending: true });
	if (error) throw error;
	return (data ?? []) as ChatMessage[];
}

export async function sendMessage(roomId: number, username: string, message: string): Promise<void> {
	const { error } = await supabase.from('messages').insert({ room_id: roomId, username, message });
	if (error) throw error;
}

export type Unsubscribe = () => void;

export function subscribeToRoomMessages(roomId: number, onInsert: (msg: ChatMessage) => void): Unsubscribe {
	const channel = supabase
		.channel(`room:${roomId}`)
		.on(
			'postgres_changes',
			{ event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
			(payload: { new: unknown }) => {
				const newRow = payload.new as ChatMessage;
				onInsert(newRow);
			}
		)
		.subscribe();
	return () => {
		supabase.removeChannel(channel);
	};
}

export async function uploadFile(file: File): Promise<{ url: string; path: string; mime: string; name: string }> {
	const bucket = import.meta.env.VITE_SUPABASE_BUCKET || 'talkdrop-uploads';
	const path = `${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;
	const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
		cacheControl: '3600',
		upsert: false,
		contentType: file.type || 'application/octet-stream'
	});
	if (error) throw error;
	const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(data.path);
	return { url: publicUrl.publicUrl, path: data.path, mime: file.type, name: file.name };
} 

// Server-persisted read receipts --------------------------------------------
// Table schema expected:
// create table if not exists read_receipts (
//   room_id integer not null references rooms(id) on delete cascade,
//   username text not null,
//   last_seen_message_id integer not null default 0,
//   updated_at timestamp with time zone default now(),
//   primary key (room_id, username)
// );

export type ReadReceipt = { room_id: number; username: string; last_seen_message_id: number };

export async function fetchReadReceipts(roomId: number): Promise<ReadReceipt[]> {
	const { data, error } = await supabase
		.from('read_receipts')
		.select('room_id, username, last_seen_message_id')
		.eq('room_id', roomId);
	if (error) throw error;
	return (data ?? []) as ReadReceipt[];
}

export async function upsertReadReceipt(roomId: number, username: string, lastSeenMessageId: number): Promise<void> {
	const { error } = await supabase
		.from('read_receipts')
		.upsert({ room_id: roomId, username, last_seen_message_id: lastSeenMessageId }, { onConflict: 'room_id,username' });
	if (error) throw error;
}