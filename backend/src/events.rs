use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct EventBus {
    redis: Option<ConnectionManager>,
    local: broadcast::Sender<Event>,
}

#[derive(Clone, Debug)]
pub struct Event {
    pub channel: String,
    pub payload: Value,
}

impl EventBus {
    pub async fn new(redis_url: &str) -> Self {
        let (tx, _) = broadcast::channel(256);

        let redis = match redis::Client::open(redis_url) {
            Ok(client) => match ConnectionManager::new(client).await {
                Ok(conn) => {
                    tracing::info!("Connected to Redis");
                    Some(conn)
                }
                Err(error) => {
                    tracing::warn!("Redis not available, using local event bus only: {}", error);
                    None
                }
            },
            Err(error) => {
                tracing::warn!("Invalid Redis configuration, using local event bus only: {}", error);
                None
            }
        };

        Self { redis, local: tx }
    }

    pub async fn publish(&self, channel: &str, payload: &Value) {
        let event = Event {
            channel: channel.to_string(),
            payload: payload.clone(),
        };

        if let Some(mut conn) = self.redis.clone() {
            let msg = serde_json::to_string(&payload).unwrap_or_default();
            let _: Result<(), _> = conn.publish(channel, msg).await;
        }

        let _ = self.local.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.local.subscribe()
    }
}
