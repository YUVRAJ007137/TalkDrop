# Message Edit/Delete - Complete Flow Reference

## User Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Message Rendering                            │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ├─ User's own message
           │  └─ Show MessageActions (⋮ dropdown)
           │
           ├─ Someone else's message
           │  └─ Hide MessageActions
           │
           └─ Deleted message (is_deleted=true)
              └─ Show "This message was deleted" (grayed out)


┌─────────────────────────────────────────────────────────────────┐
│                   User Clicks Edit                              │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ├─ MessageActions.onEdit triggered
           │  └─ Local state: isEditing = true
           │
           ├─ Show inline text editor
           │  ├─ Text input (autofocus)
           │  ├─ Save button
           │  └─ Cancel button
           │
           ├─ User modifies text and clicks Save
           │  └─ handleEditMessage(messageId, newText) called
           │
           ├─ API Call: editMessage(id, text, username)
           │  └─ Backend:
           │     ├─ Store original_message (if not already stored)
           │     ├─ Update message text
           │     ├─ Set edited_at timestamp
           │     ├─ Insert into message_edits audit table
           │     └─ Trigger postgres_changes UPDATE event
           │
           ├─ Optimistic UI Update
           │  ├─ Update message state locally
           │  ├─ Set edited_at = now
           │  └─ Show "(edited)" label
           │
           └─ Real-time Sync (postgres_changes subscription)
              ├─ Trigger: UPDATE on messages table (room_id filter)
              ├─ Event: { new: { id, message, edited_at, ... } }
              ├─ All connected clients receive UPDATE
              └─ All clients update state via setMessages()


┌─────────────────────────────────────────────────────────────────┐
│                   User Clicks Delete                            │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ├─ MessageActions.onDelete triggered
           │  └─ Show confirmation: "Delete this message?"
           │
           ├─ User confirms
           │  └─ handleDeleteMessage(messageId) called
           │
           ├─ API Call: deleteMessage(id)
           │  └─ Backend:
           │     ├─ Set is_deleted = true
           │     ├─ Set edited_at timestamp (for audit)
           │     ├─ Insert into message_edits audit table
           │     └─ Trigger postgres_changes UPDATE event
           │
           ├─ Optimistic UI Update
           │  ├─ Set message.is_deleted = true
           │  └─ MessageBubble renders deleted state
           │
           └─ Real-time Sync (postgres_changes subscription)
              ├─ Trigger: UPDATE on messages table
              ├─ Event: { new: { id, is_deleted: true, ... } }
              ├─ All connected clients receive UPDATE
              └─ All clients show "This message was deleted"
```

## Key Code Patterns

### Deleted Message Display
```typescript
if (msg.is_deleted) {
  return (
    <div className={`message ${isSelf ? 'self' : ''}`} style={{ opacity: 0.5 }}>
      <div style={{ fontStyle: 'italic', color: 'var(--wa-muted)' }}>
        This message was deleted
      </div>
    </div>
  );
}
```

### Edited Message Indicator
```typescript
{msg.edited_at && (
  <div style={{ fontSize: 11, color: 'var(--wa-muted)', marginTop: 2 }}>
    (edited)
  </div>
)}
```

### Edit Handler
```typescript
async function handleEditMessage(messageId: number, newText: string) {
  await editMessage(messageId, newText, me);
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === messageId
        ? { ...msg, message: makeTextMessage(newText, ...), edited_at: new Date().toISOString() }
        : msg
    )
  );
}
```

### Delete Handler
```typescript
async function handleDeleteMessage(messageId: number) {
  await deleteMessage(messageId);
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === messageId ? { ...msg, is_deleted: true } : msg
    )
  );
}
```

### Real-Time Subscription
```typescript
useEffect(() => {
  const channel = supabase
    .channel(`room:${room.id}:message-edits`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', 
        filter: `room_id=eq.${room.id}` },
      (payload: any) => {
        const updatedRow = payload.new;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === updatedRow.id
              ? { ...msg, is_deleted: updatedRow.is_deleted, edited_at: updatedRow.edited_at }
              : msg
          )
        );
      }
    )
    .subscribe();

  return () => { channel.unsubscribe(); };
}, [room.id]);
```

## Database Schema Changes

```sql
-- Add columns to messages table
ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN original_message TEXT;

-- Create audit table
CREATE TABLE message_edits (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES messages(id),
  username TEXT,
  old_message TEXT,
  new_message TEXT,
  edited_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Security Requirements (TODO)

Add Supabase Row-Level Security (RLS) policies:
```sql
-- Users can only edit their own messages
CREATE POLICY "users_edit_own_messages" ON messages
  FOR UPDATE USING (auth.jwt()->>'user_id' = (
    SELECT id FROM public.users WHERE username = messages.username
  ));

-- Users can only see non-deleted messages (or deleted if they authored it)
CREATE POLICY "users_see_non_deleted" ON messages
  FOR SELECT USING (
    is_deleted = false OR 
    (auth.jwt()->>'user_id' = (SELECT id FROM public.users WHERE username = messages.username))
  );
```
