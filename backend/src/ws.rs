use axum::extract::ws::{Message, WebSocket};
use futures::stream::SplitSink;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

use crate::events::Event;

type SenderMap = Arc<RwLock<HashMap<Uuid, Vec<broadcast::Sender<Event>>>>>;

#[derive(Clone)]
pub struct WsManager {
    subscribers: SenderMap,
}

impl WsManager {
    pub fn new() -> Self {
        Self {
            subscribers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn handle_socket(self, socket: WebSocket, user_id: Uuid) {
        let (sender, mut receiver) = socket.split();
        let sender = Arc::new(Mutex::new(sender));

        let (tx, mut rx) = broadcast::channel(64);
        {
            let mut subs = self.subscribers.write().await;
            subs.entry(user_id).or_default().push(tx);
        }

        let send_clone = sender.clone();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        let msg = serde_json::to_string(&event.payload).unwrap_or_default();
                        let mut s = send_clone.lock().await;
                        if s.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        });

        while let Some(Ok(msg)) = receiver.recv().await {
            if let Message::Close(_) = msg {
                break;
            }
        }

        let mut subs = self.subscribers.write().await;
        subs.remove(&user_id);
    }

    pub async fn broadcast_user(&self, user_id: Uuid, event: Event) {
        let subs = self.subscribers.read().await;
        if let Some(senders) = subs.get(&user_id) {
            for tx in senders {
                let _ = tx.send(event.clone());
            }
        }
    }
}
