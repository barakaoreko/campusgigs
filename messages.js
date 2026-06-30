/* =========================================================
   CAMPUSGIGS — MESSAGES
   Handles: the conversation list, opening a chat with a
   specific person, sending messages, and live updates via
   Supabase Realtime so replies show up without a refresh.

   Requires auth.js to be loaded first (for CampusGigsAuth).
   ========================================================= */

(function () {
  "use strict";

  const supabase = window.supabaseClient;

  const messagesModal = document.getElementById("messages-modal");
  const closeMessagesBtn = document.getElementById("close-messages-modal");
  const openMessagesNav = document.getElementById("open-messages-nav");
  const conversationListEl = document.getElementById("conversation-list");
  const chatPaneEl = document.getElementById("chat-pane");

  let activePeerId = null;
  let activePeerName = "";
  let realtimeChannel = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function formatTimestamp(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function openMessagesModal() {
    messagesModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeMessagesModal() {
    messagesModal.hidden = true;
    document.body.style.overflow = "";
    teardownRealtime();
  }

  closeMessagesBtn.addEventListener("click", closeMessagesModal);
  messagesModal.addEventListener("click", (e) => {
    if (e.target === messagesModal) closeMessagesModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !messagesModal.hidden) closeMessagesModal();
  });

  /* ---------- Building the list of people this user has messaged ---------- */

  async function loadConversations() {
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    if (!currentUser) return [];

    // Pull every message involving this user, newest first, then
    // collapse to one entry per "other person" client-side. Message
    // volume per user is small enough that this is simpler and more
    // reliable than a separate conversations table to keep in sync.
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Couldn't load conversations:", error.message);
      return [];
    }

    const seen = new Map();
    for (const msg of data) {
      const peerId = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id;
      if (!seen.has(peerId)) {
        seen.set(peerId, { peerId, lastMessage: msg.content, lastAt: msg.created_at });
      }
    }
    return Array.from(seen.values());
  }

  async function fetchPeerNames(peerIds) {
    if (peerIds.length === 0) return new Map();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", peerIds);

    if (error) {
      console.error("Couldn't load conversation names:", error.message);
      return new Map();
    }
    return new Map(data.map((p) => [p.id, p]));
  }

  async function renderConversationList() {
    conversationListEl.innerHTML = `<p class="form-hint" style="padding:16px;">Loading...</p>`;
    const conversations = await loadConversations();

    if (conversations.length === 0) {
      conversationListEl.innerHTML = `<p class="form-hint" style="padding:16px;">No conversations yet.</p>`;
      return;
    }

    const peers = await fetchPeerNames(conversations.map((c) => c.peerId));

    conversationListEl.innerHTML = "";
    conversations.forEach((conv) => {
      const peer = peers.get(conv.peerId);
      const name = peer?.full_name || "Unknown user";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "conversation-item";
      if (conv.peerId === activePeerId) item.classList.add("is-active");
      item.innerHTML = `
        <span class="conversation-name">${escapeHtml(name)}</span>
        <span class="conversation-preview">${escapeHtml(conv.lastMessage)}</span>
      `;
      item.addEventListener("click", () => openConversationWith(conv.peerId, name));
      conversationListEl.appendChild(item);
    });
  }

  /* ---------- Active chat pane ---------- */

  async function loadMessagesWith(peerId) {
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${peerId}),` +
        `and(sender_id.eq.${peerId},receiver_id.eq.${currentUser.id})`
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Couldn't load messages:", error.message);
      return [];
    }
    return data;
  }

  function renderChatMessages(messages) {
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    const list = document.getElementById("chat-message-list");
    if (!list) return;

    list.innerHTML = messages
      .map((m) => {
        const mine = m.sender_id === currentUser.id;
        return `
          <div class="chat-bubble ${mine ? "chat-bubble-mine" : "chat-bubble-theirs"}">
            <p>${escapeHtml(m.content)}</p>
            <span class="chat-bubble-time">${formatTimestamp(m.created_at)}</span>
          </div>
        `;
      })
      .join("");

    list.scrollTop = list.scrollHeight;
  }

  async function openConversationWith(peerId, peerName) {
    activePeerId = peerId;
    activePeerName = peerName;

    chatPaneEl.innerHTML = `
      <div class="chat-header">${escapeHtml(peerName)}</div>
      <div class="chat-message-list" id="chat-message-list"></div>
      <form class="chat-input-row" id="chat-send-form">
        <input type="text" id="chat-input" placeholder="Write a message..." required autocomplete="off">
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    `;

    const messages = await loadMessagesWith(peerId);
    renderChatMessages(messages);

    document.getElementById("chat-send-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("chat-input");
      const content = input.value.trim();
      if (!content) return;

      const currentUser = window.CampusGigsAuth.getCurrentUser();
      const { error } = await supabase.from("messages").insert({
        sender_id: currentUser.id,
        receiver_id: peerId,
        content
      });

      if (error) {
        alert(error.message); // Rare path (RLS/network); a blocking alert is fine here.
        return;
      }
      input.value = "";
      // The realtime subscription below will also pick this up, but
      // refreshing immediately means the sender sees it with zero lag.
      renderChatMessages(await loadMessagesWith(peerId));
    });

    setupRealtime(peerId);
    renderConversationList(); // refresh the list so this conversation shows/bubbles up
  }

  /* ---------- Realtime: live-receive new messages without refreshing ---------- */

  function setupRealtime(peerId) {
    teardownRealtime();
    const currentUser = window.CampusGigsAuth.getCurrentUser();

    realtimeChannel = supabase
      .channel(`messages-${currentUser.id}-${peerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new;
          const isThisConversation =
            (m.sender_id === currentUser.id && m.receiver_id === peerId) ||
            (m.sender_id === peerId && m.receiver_id === currentUser.id);
          if (isThisConversation) {
            loadMessagesWith(peerId).then(renderChatMessages);
          }
        }
      )
      .subscribe();
  }

  function teardownRealtime() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  /* ---------- Public entry point: open messages, optionally to one person ---------- */

  async function openMessages() {
    if (!window.CampusGigsAuth.requireLogin()) return;
    openMessagesModal();
    chatPaneEl.innerHTML = `<p class="chat-empty-state">Select a conversation, or message someone from their listing.</p>`;
    await renderConversationList();
  }

  async function openConversationWithEntry(peerId, peerName) {
    if (!window.CampusGigsAuth.requireLogin()) return;
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    if (currentUser.id === peerId) return; // can't message yourself
    openMessagesModal();
    await renderConversationList();
    await openConversationWith(peerId, peerName);
  }

  openMessagesNav.addEventListener("click", (e) => {
    e.preventDefault();
    openMessages();
  });

  window.CampusGigsMessages = {
    openMessages,
    openConversationWith: openConversationWithEntry
  };
})();