export type Room = {
	id: number;
	room_name: string;
	password: string | null;
};

export type ChatMessage = {
	id: number;
	room_id: number;
	username: string;
	message: string; // can be plain text or JSON string for file payload
	timestamp: string;
};

export type ParsedMessage =
	| { kind: 'text'; text: string }
	| { kind: 'file'; url: string; mime: string; name: string };

export function parseMessagePayload(raw: string): ParsedMessage {
	try {
		const data = JSON.parse(raw);
		if (data && data.kind === 'file' && typeof data.url === 'string') {
			return {
				kind: 'file',
				url: data.url,
				mime: data.mime ?? 'application/octet-stream',
				name: data.name ?? 'file'
			};
		}
		if (data && data.kind === 'text' && typeof data.text === 'string') {
			return { kind: 'text', text: data.text };
		}
		// fallthrough to plain text
		return { kind: 'text', text: raw };
	} catch {
		return { kind: 'text', text: raw };
	}
}

export function makeFileMessage(url: string, mime: string, name: string): string {
	return JSON.stringify({ kind: 'file', url, mime, name });
}

export function makeTextMessage(text: string): string {
	return JSON.stringify({ kind: 'text', text });
} 