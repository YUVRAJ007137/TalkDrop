import type SimplePeer from 'simple-peer';
import SimplePeerConstructor from 'simple-peer';
import * as React from 'react';
import { supabase } from './supabaseClient';

export type CallState = 'idle' | 'calling' | 'incoming' | 'connected' | 'ended';

export type VideoCallState = {
	state: CallState;
	remoteUsername: string | null;
	error: string | null;
	localStream: MediaStream | null;
	remoteStream: MediaStream | null;
};

export type SignalingPayload =
	| { type: 'call-request'; from: string; to: string }
	| { type: 'call-accept'; from: string; to: string }
	| { type: 'call-reject'; from: string; to: string }
	| { type: 'signal'; from: string; to: string; data: SimplePeer.SignalData }
	| { type: 'hangup'; from: string; to: string };

const EVENT = 'webrtc';

function createCallChannel(roomId: number) {
	return supabase.channel(`room:${roomId}:video-call`, {
		config: { broadcast: { self: false, ack: false } }
	});
}

export async function getLocalStream(): Promise<MediaStream> {
	return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

export function createVideoCallHandler(
	roomId: number,
	myUsername: string,
	onStateChange: (state: VideoCallState) => void
) {
	let channel: ReturnType<typeof createCallChannel> | null = null;
	let peer: InstanceType<typeof SimplePeerConstructor> | null = null;
	let localStream: MediaStream | null = null;
	let remoteUsername: string | null = null;

	function setState(partial: Partial<VideoCallState>) {
		onStateChange({
			state: 'idle',
			remoteUsername: null,
			error: null,
			localStream: null,
			remoteStream: null,
			...partial
		});
	}

	function cleanup() {
		if (peer) {
			try {
				peer.destroy();
			} catch (_) {}
			peer = null;
		}
		if (localStream) {
			localStream.getTracks().forEach((t) => t.stop());
			localStream = null;
		}
		remoteUsername = null;
	}

	function send(payload: SignalingPayload) {
		if (!channel) return;
		channel.send({ type: 'broadcast', event: EVENT, payload }).catch(() => {});
	}

	function handleSignal(from: string, to: string, data: SimplePeer.SignalData) {
		if (to !== myUsername || !peer) return;
		try {
			peer.signal(data);
		} catch (e) {
			console.warn('peer.signal error', e);
		}
	}

	function handleIncoming(from: string) {
		setState({ state: 'incoming', remoteUsername: from });
	}

	function handleAcceptAsCallee(from: string) {
		// We are the callee: create peer (initiator: false), wait for offer via signal
		getLocalStream().then(
			(stream) => {
				localStream = stream;
				peer = new SimplePeerConstructor({ initiator: false, stream, trickle: true });
				peer.on('signal', (data) => {
					send({ type: 'signal', from: myUsername, to: from, data });
				});
				peer.on('stream', (stream) => {
					setState({ state: 'connected', remoteUsername: from, localStream, remoteStream: stream });
				});
				peer.on('close', () => {
					cleanup();
					setState({ state: 'ended' });
				});
				peer.on('error', (err) => {
					cleanup();
					setState({ state: 'ended', error: err.message });
				});
				// Show call overlay (connecting) so modal closes and user sees local video
				setState({ state: 'calling', remoteUsername: from, localStream: stream });
			},
			(err) => {
				setState({ state: 'idle', error: err.message || 'Could not access camera/microphone' });
			}
		);
	}

	function handleAcceptAsCaller(from: string) {
		// We are the caller: they accepted, create our peer (initiator: true) and send offer
		if (remoteUsername !== from) return;
		getLocalStream().then(
			(stream) => {
				localStream = stream;
				peer = new SimplePeerConstructor({ initiator: true, stream, trickle: true });
				peer.on('signal', (data) => {
					send({ type: 'signal', from: myUsername, to: from, data });
				});
				peer.on('stream', (stream) => {
					setState({ state: 'connected', remoteUsername: from, localStream, remoteStream: stream });
				});
				peer.on('close', () => {
					cleanup();
					setState({ state: 'ended' });
				});
				peer.on('error', (err) => {
					cleanup();
					setState({ state: 'ended', error: err.message });
				});
				setState({ state: 'calling', remoteUsername: from, localStream });
			},
			(err) => {
				setState({ state: 'idle', error: err?.message || 'Could not access camera/microphone' });
			}
		);
	}

	function subscribe() {
		if (channel) return;
		channel = createCallChannel(roomId);
		(channel as any).on('broadcast', { event: EVENT }, (p: { payload?: SignalingPayload } & Record<string, unknown>) => {
			// Supabase may pass payload at p.payload or at top level
			const payload = (p?.payload ?? p) as SignalingPayload | undefined;
			if (!payload || typeof payload !== 'object' || !('to' in payload) || payload.to !== myUsername) return;
			switch (payload.type) {
				case 'call-request':
					handleIncoming(payload.from);
					break;
				case 'call-accept':
					// Only the caller receives call-accept (callee sends it and creates peer in acceptCall)
					handleAcceptAsCaller(payload.from);
					break;
				case 'call-reject':
					if (remoteUsername === payload.from) {
						cleanup();
						setState({ state: 'idle' });
					}
					break;
				case 'signal':
					if ('data' in payload && payload.data != null) {
						handleSignal(payload.from, payload.to, payload.data);
					}
					break;
				case 'hangup':
					if (remoteUsername === payload.from) {
						cleanup();
						setState({ state: 'ended' });
					}
					break;
			}
		});
		(channel as any).subscribe?.((status: string) => {
			subscribeCallback?.(status);
		});
	}

	let subscribeCallback: ((status: string) => void) | null = null;

	function subscribeAsync(): Promise<void> {
		return new Promise((resolve) => {
			if (channel) {
				resolve();
				return;
			}
			subscribeCallback = (status: string) => {
				if (status === 'SUBSCRIBED') {
					subscribeCallback = null;
					resolve();
				}
			};
			subscribe();
			// Fallback: resolve after 3s so we don't block forever
			setTimeout(() => {
				if (subscribeCallback) {
					subscribeCallback = null;
					resolve();
				}
			}, 3000);
		});
	}

	function unsubscribe() {
		cleanup();
		if (channel) {
			supabase.removeChannel(channel);
			channel = null;
		}
		setState({ state: 'idle' });
	}

	async function startCall(to: string) {
		remoteUsername = to;
		setState({ state: 'calling', remoteUsername: to });
		await subscribeAsync();
		send({ type: 'call-request', from: myUsername, to });
		// Peer is created when we receive call-accept (handleAcceptAsCaller)
	}

	function acceptCall(from: string) {
		remoteUsername = from;
		send({ type: 'call-accept', from: myUsername, to: from });
		handleAcceptAsCallee(from);
	}

	function rejectCall(from: string) {
		send({ type: 'call-reject', from: myUsername, to: from });
		setState({ state: 'idle', remoteUsername: null });
	}

	function hangup() {
		if (remoteUsername) {
			send({ type: 'hangup', from: myUsername, to: remoteUsername });
		}
		cleanup();
		setState({ state: 'idle' });
	}

	return {
		subscribe,
		unsubscribe,
		startCall,
		acceptCall,
		rejectCall,
		hangup
	};
}

export type VideoCallActions = ReturnType<typeof createVideoCallHandler>;
const INITIAL_STATE: VideoCallState = {
	state: 'idle',
	remoteUsername: null,
	error: null,
	localStream: null,
	remoteStream: null
};

export function useVideoCall(roomId: number, myUsername: string) {
	const [state, setState] = React.useState<VideoCallState>(INITIAL_STATE);
	const handlerRef = React.useRef<VideoCallActions | null>(null);

	React.useEffect(() => {
		handlerRef.current = createVideoCallHandler(roomId, myUsername, (next) => setState({ ...INITIAL_STATE, ...next }));
		handlerRef.current.subscribe();
		return () => {
			handlerRef.current?.unsubscribe();
			handlerRef.current = null;
		};
	}, [roomId, myUsername]);

	return {
		state,
		startCall: (to: string) => handlerRef.current?.startCall(to),
		acceptCall: (from: string) => handlerRef.current?.acceptCall(from),
		rejectCall: (from: string) => handlerRef.current?.rejectCall(from),
		hangup: () => handlerRef.current?.hangup()
	};
}
