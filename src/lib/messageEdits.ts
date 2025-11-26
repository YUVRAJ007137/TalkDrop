import { supabase } from './supabaseClient';

/**
 * Soft-delete a message (set is_deleted = true)
 */
export async function deleteMessage(messageId: number): Promise<void> {
	const { error } = await supabase
		.from('messages')
		.update({ is_deleted: true })
		.eq('id', messageId);
	if (error) throw error;
}

/**
 * Edit a message (update content, set edited_at, store original)
 * Also logs to message_edits table for audit trail
 */
export async function editMessage(messageId: number, newMessage: string, username: string): Promise<void> {
	// fetch the current message to store as original if not already stored
	const { data: msg, error: fetchErr } = await supabase
		.from('messages')
		.select('message, original_message')
		.eq('id', messageId)
		.single();
	if (fetchErr) throw fetchErr;
	
	const originalMsg = msg?.original_message ?? msg?.message ?? '';
	const { error } = await supabase
		.from('messages')
		.update({ message: newMessage, edited_at: new Date().toISOString(), original_message: originalMsg })
		.eq('id', messageId);
	if (error) throw error;
	
	// also log to edit history for audit trail
	try {
		await supabase
			.from('message_edits')
			.insert({ message_id: messageId, username, old_message: originalMsg, new_message: newMessage });
	} catch (e) {
		// ignore edit history errors (non-critical)
		console.warn('Failed to log message edit', e);
	}
}
