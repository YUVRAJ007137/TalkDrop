import { useState } from 'react';

interface MessageActionsProps {
	messageId: number;
	messageText: string;
	isSelf: boolean;
	editedAt?: string;
	onDelete: (messageId: number) => void;
	onEdit: (messageId: number, newText: string) => void;
}

export function MessageActions({ messageId, messageText, isSelf, editedAt, onDelete, onEdit }: MessageActionsProps) {
	const [showMenu, setShowMenu] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState(messageText);

	if (!isSelf) return null; // only show for own messages

	const handleDelete = () => {
		if (window.confirm('Delete this message?')) {
			onDelete(messageId);
			setShowMenu(false);
		}
	};

	const handleEditSave = () => {
		if (editText.trim() && editText !== messageText) {
			onEdit(messageId, editText.trim());
			setIsEditing(false);
			setShowMenu(false);
		} else {
			setIsEditing(false);
		}
	};

	if (isEditing) {
		return (
			<div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
				<input
					type="text"
					value={editText}
					onChange={(e) => setEditText(e.target.value)}
					style={{
						flex: 1,
						padding: '4px 8px',
						borderRadius: 4,
						border: '1px solid var(--wa-accent)',
						backgroundColor: 'var(--wa-panel)',
						color: 'var(--wa-text)',
						fontSize: 12
					}}
					placeholder="Edit message..."
					autoFocus
				/>
				<button
					onClick={handleEditSave}
					style={{
						padding: '4px 8px',
						fontSize: 11,
						backgroundColor: 'var(--wa-accent)',
						color: 'white',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer'
					}}
				>
					Save
				</button>
				<button
					onClick={() => setIsEditing(false)}
					style={{
						padding: '4px 8px',
						fontSize: 11,
						backgroundColor: 'var(--wa-panel-light)',
						color: 'var(--wa-text)',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer'
					}}
				>
					Cancel
				</button>
			</div>
		);
	}

	return (
		<div style={{ position: 'relative', display: 'inline-block', marginTop: 4 }}>
			<button
				onClick={() => setShowMenu(!showMenu)}
				style={{
					padding: '2px 6px',
					fontSize: 11,
					backgroundColor: 'transparent',
					border: '1px solid var(--wa-muted)',
					color: 'var(--wa-muted)',
					borderRadius: 3,
					cursor: 'pointer'
				}}
				title="Message actions"
			>
				⋮
			</button>
			{showMenu && (
				<div
					style={{
						position: 'absolute',
						top: 24,
						right: 0,
						backgroundColor: 'var(--wa-panel-light)',
						border: '1px solid var(--wa-muted)',
						borderRadius: 4,
						zIndex: 10,
						minWidth: 100
					}}
				>
					<button
						onClick={() => {
							setIsEditing(true);
							setShowMenu(false);
						}}
						style={{
							display: 'block',
							width: '100%',
							padding: '6px 8px',
							textAlign: 'left',
							fontSize: 12,
							backgroundColor: 'transparent',
							border: 'none',
							color: 'var(--wa-text)',
							cursor: 'pointer'
						}}
						onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--wa-panel)')}
						onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
					>
						Edit
					</button>
					<button
						onClick={handleDelete}
						style={{
							display: 'block',
							width: '100%',
							padding: '6px 8px',
							textAlign: 'left',
							fontSize: 12,
							backgroundColor: 'transparent',
							border: 'none',
							color: '#d9534f',
							cursor: 'pointer'
						}}
						onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--wa-panel)')}
						onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
					>
						Delete
					</button>
				</div>
			)}
			{editedAt && (
				<span style={{ fontSize: 10, color: 'var(--wa-muted)', marginLeft: 6 }}>
					(edited)
				</span>
			)}
		</div>
	);
}
