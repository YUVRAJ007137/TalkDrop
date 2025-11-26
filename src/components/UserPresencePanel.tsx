import { useMemo, useState } from 'react';
import type { UserPresence } from '../types';

function formatLastSeen(lastActivityMs: number): string {
	const now = Date.now();
	const diffMs = now - lastActivityMs;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHour / 24);

	if (diffSec < 60) {
		return 'Just now';
	}
	if (diffMin < 60) {
		return `${diffMin}m ago`;
	}
	if (diffHour < 24) {
		return `${diffHour}h ago`;
	}
	if (diffDay < 7) {
		return `${diffDay}d ago`;
	}

	// Format as date and time
	const date = new Date(lastActivityMs);
	const formatter = new Intl.DateTimeFormat('en-IN', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
		timeZone: 'Asia/Kolkata'
	});
	return formatter.format(date);
}

function getStatusColor(isOnline: boolean): string {
	return isOnline ? '#31a24c' : '#aaa'; // green for online, gray for offline
}

function getStatusLabel(isOnline: boolean): string {
	return isOnline ? 'Online now' : 'Away';
}

export function UserPresencePanel({ users, currentUsername }: { users: UserPresence[]; currentUsername: string }) {
	const sortedUsers = useMemo(() => {
		return [...users]
			.filter((u) => u.username !== currentUsername) // exclude self
			.sort((a, b) => {
				// Online users first, then by most recent activity
				if (a.isOnline !== b.isOnline) {
					return a.isOnline ? -1 : 1;
				}
				return b.lastActivity - a.lastActivity;
			});
	}, [users, currentUsername]);

	const [showLastSeen, setShowLastSeen] = useState(true);

	if (sortedUsers.length === 0) {
		return (
			<div className="user-presence-panel">
				<div className="presence-empty">No users have been in this room yet</div>
			</div>
		);
	}

	const online = sortedUsers.filter((u) => u.isOnline);
	const offline = sortedUsers.filter((u) => !u.isOnline);

	return (
		<div className="user-presence-panel">
			<div className="presence-header">👥 Users ({sortedUsers.length})</div>
			{/* Online users - prominent */}
			{online.length > 0 && (
				<div className="presence-list">
					{online.map((user) => (
						<div key={user.username} className="presence-item">
							<div className="presence-user-info">
								{/* Mood emoji (if any) */}
								{user.mood ? <span className="presence-mood" aria-hidden style={{ marginRight: 6 }}>{user.mood}</span> : null}
								<span className="presence-status" style={{ color: getStatusColor(user.isOnline), marginRight: 6 }}>●</span>
								<span className="presence-username">{user.username}</span>
							</div>
							<div className="presence-details">
								<div className="presence-label">{getStatusLabel(user.isOnline)}</div>
								<div className="presence-timestamp">Last seen: {formatLastSeen(user.lastActivity)}</div>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Offline / historical users - collapsible last seen list */}
			{offline.length > 0 && (
				<div className="last-seen-block">
					<button className="last-seen-toggle" onClick={() => setShowLastSeen((v) => !v)} aria-expanded={showLastSeen}>
						Last seen ({offline.length}) {showLastSeen ? '▾' : '▸'}
					</button>
					{showLastSeen && (
						<div className="last-seen-list">
							{offline.map((user) => (
								<div key={user.username} className="presence-item last-seen-item">
									<div className="presence-user-info">
										{user.mood ? <span className="presence-mood" aria-hidden style={{ marginRight: 6 }}>{user.mood}</span> : null}
										<span className="presence-status" style={{ color: getStatusColor(user.isOnline), marginRight: 6 }}>●</span>
										<span className="presence-username">{user.username}</span>
									</div>
									<div className="presence-details">
										<div className="presence-label">{getStatusLabel(user.isOnline)}</div>
										<div className="presence-timestamp">Last seen: {formatLastSeen(user.lastActivity)}</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
