import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { ensureShopOwnerSupportConversation, listSupportMessages, sendSupportMessage } from '../lib/supportChat';
import './shopOwnerDashboardPremium.css';
import './shopOwnerSupportChatPremium.css';

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatMessageTime(ts) {
  if (!ts) return timeNow();
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return timeNow();
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function toUiMessage(row) {
  if (row.sender_role === 'system') return { id: row.id, kind: 'sys', text: row.body };
  return {
    id: row.id,
    kind: row.sender_role === 'admin' ? 'recv' : 'sent',
    text: row.body,
    t: formatMessageTime(row.created_at),
    read: row.sender_role !== 'admin',
  };
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path d="M15.5 19.5L8 12l7.5-7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Ticks() {
  return (
    <span className="soc-tick" aria-label="Read">
      <svg viewBox="0 0 20 10" width="16" height="8" fill="none" aria-hidden>
        <path d="M1.5 5.5l2.2 2.2L6.8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M6.5 5.5l2.2 2.2L11.8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function ShopOwnerSupportChatPage() {
  const navigate = useNavigate();
  const session = getShopOwnerSession();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const endRef = useRef(null);

  const loadMessages = useCallback(async (convId) => {
    if (!convId) return;
    const { data, error } = await listSupportMessages(convId);
    if (error) return;
    if (Array.isArray(data) && data.length > 0) {
      setMessages(data.map(toUiMessage));
      return;
    }
    const shopName = session?.business_name || 'Shop Partner';
    setMessages([
      { id: 'shop-welcome-1', kind: 'recv', text: `Hi ${shopName}! Admin support is online.`, t: timeNow() },
      { id: 'shop-welcome-2', kind: 'sys', text: 'Share your issue here and admin will reply in this chat.' },
    ]);
  }, [session?.business_name]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { conversation, error } = await ensureShopOwnerSupportConversation(session);
      if (!alive || error || !conversation?.id) return;
      setConversationId(conversation.id);
      await loadMessages(conversation.id);
    })();
    return () => {
      alive = false;
    };
  }, [loadMessages, session]);

  useEffect(() => {
    if (!conversationId) return undefined;
    const timer = window.setInterval(() => {
      loadMessages(conversationId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !conversationId) return;
    setInput('');
    sendSupportMessage({
      conversationId,
      senderRole: 'customer',
      body: text,
      adminDisplayName: null,
      authorAppUserId: null,
    }).then(() => loadMessages(conversationId));
  }, [conversationId, input, loadMessages]);

  return (
    <div className="soc-page" role="main" aria-label="Shop owner support chat">
      <header className="soc-header-card">
        <button type="button" className="soc-back" onClick={() => navigate('/shop-owner/dashboard')} aria-label="Back">
          <BackIcon />
        </button>
        <div className="soc-header-center">
          <div className="soc-avatar-wrap">
            <span className="soc-avatar" aria-hidden>
              A
            </span>
            <span className="soc-online-dot" aria-hidden />
          </div>
          <h1 className="soc-name">InGo Admin Support</h1>
          <p className="soc-status">
            <span className="soc-status-dot" aria-hidden />
            <span>● Support</span>
          </p>
          <span className="soc-badge-pill" aria-label="Chat type">
            Shop owner support
          </span>
        </div>
      </header>

      <div className="soc-messages" aria-live="polite" aria-atomic="false">
        {messages.map((m) => {
          if (m.kind === 'sys') {
            return (
              <div key={m.id} className="soc-sys" role="status">
                {m.text}
              </div>
            );
          }
          if (m.kind === 'recv') {
            return (
              <div key={m.id} className="soc-row soc-row--recv">
                <span className="soc-msg-avatar" aria-hidden />
                <div className="soc-msg-block">
                  <div className="soc-bubble soc-bubble--recv">{m.text}</div>
                  <time className="soc-meta soc-meta--left" dateTime={m.t}>
                    {m.t}
                  </time>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="soc-row soc-row--sent">
              <div className="soc-msg-block">
                <div className="soc-bubble soc-bubble--sent">{m.text}</div>
                <div className="soc-meta soc-meta--right">
                  <time dateTime={m.t}>{m.t}</time>
                  {m.read ? <Ticks /> : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="soc-input-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="soc-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message InGo Admin..."
          aria-label="Type a message"
        />
        <button type="submit" className="soc-send" aria-label="Send message">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
