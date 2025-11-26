-- Update src/types.ts: add is_deleted and edited_at to ChatMessage type
-- Replace the ChatMessage type definition with this:

export type ChatMessage = {
	id: number;
	room_id: number;
	username: string;
	message: string; // can be plain text or JSON string for file payload
	timestamp: string;
	status?: MessageStatus;
	clientId?: string;
	is_deleted?: boolean; // NEW: soft-delete flag
	edited_at?: string; // NEW: timestamp when message was edited
	original_message?: string; // NEW: original message before edit
};
