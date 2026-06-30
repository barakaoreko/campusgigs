/* =========================================================
   CAMPUSGIGS — PROFILES
   Handles: loading the logged-in user's profile, the "My
   profile" edit form, viewing other users' public profiles,
   and uploading a small avatar image to Supabase Storage.

   Requires auth.js to be loaded first (for CampusGigsAuth).
   ========================================================= */

(function () {
  "use strict";

  const supabase = window.supabaseClient;

  const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB cap keeps uploads fast
  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

  const profileModal = document.getElementById("profile-modal");
  const profileContent = document.getElementById("profile-content");
  const openProfileBtn = document.getElementById("open-profile-form");
  const closeProfileBtn = document.getElementById("close-profile-modal");

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function openProfileModal() {
    profileModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeProfileModal() {
    profileModal.hidden = true;
    document.body.style.overflow = "";
  }

  closeProfileBtn.addEventListener("click", closeProfileModal);
  profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) closeProfileModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !profileModal.hidden) closeProfileModal();
  });

  /* ---------- Fetching a profile row ---------- */

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Couldn't load profile:", error.message);
      return null;
    }
    return data;
  }

  /* ---------- Avatar upload ---------- */

  async function uploadAvatar(userId, file) {
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      throw new Error("Please choose a JPG, PNG, or WEBP image.");
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new Error("Image is too large — please choose one under 2MB.");
    }

    const extension = file.name.split(".").pop();
    // One fixed filename per user (not a random name) so re-uploading
    // replaces the old picture instead of leaving orphaned files behind.
    const path = `${userId}/avatar.${extension}`;

    const { error: uploadError } = await supabase
      .storage
      .from("avatars")
      .upload(path, file, { upsert: true, cacheControl: "3600" });

    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // Cache-bust so the new picture shows immediately instead of a
    // browser-cached copy of the old one at the same URL.
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  /* ---------- Rendering: editable "My Profile" form ---------- */

  function renderOwnProfileForm(profile) {
    profileContent.innerHTML = `
      <p class="eyebrow-stamp">YOUR PROFILE</p>
      <h2>Edit your profile</h2>

      <div class="profile-avatar-row">
        <img
          src="${profile.avatar_url || ""}"
          alt=""
          class="profile-avatar-preview"
          id="avatar-preview"
          style="${profile.avatar_url ? "" : "display:none;"}"
        >
        <div class="profile-avatar-placeholder" id="avatar-placeholder" style="${profile.avatar_url ? "display:none;" : ""}">
          ${escapeHtml((profile.full_name || "?").slice(0, 1).toUpperCase())}
        </div>
        <div>
          <label for="avatar-input" class="btn btn-ghost btn-small">Change photo</label>
          <input type="file" id="avatar-input" accept="image/jpeg,image/png,image/webp" class="sr-only">
          <p class="form-hint">JPG, PNG, or WEBP. Max 2MB.</p>
        </div>
      </div>

      <form id="profile-edit-form">
        <div class="form-row">
          <label for="p-name">Full name</label>
          <input type="text" id="p-name" required value="${escapeHtml(profile.full_name)}">
        </div>
        <div class="form-row">
          <label for="p-email">Email</label>
          <input type="email" id="p-email" value="${escapeHtml(profile.email)}" disabled>
          <p class="form-hint">Your email is managed through account settings, not here.</p>
        </div>
        <div class="form-row">
          <label for="p-university">University (optional)</label>
          <input type="text" id="p-university" value="${escapeHtml(profile.university)}" placeholder="e.g. University of Dar es Salaam">
        </div>
        <div class="form-row">
          <label for="p-bio">Bio / about me</label>
          <textarea id="p-bio" rows="3" placeholder="A couple sentences about you.">${escapeHtml(profile.bio)}</textarea>
        </div>
        <div class="form-row">
          <label for="p-skills">Skills</label>
          <input type="text" id="p-skills" value="${escapeHtml(profile.skills)}" placeholder="e.g. Calculus, React, Logo design">
          <p class="form-hint">Separate multiple skills with commas.</p>
        </div>
        <p class="form-hint">Joined ${new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</p>
        <button type="submit" class="btn btn-primary btn-block">Save profile</button>
        <p class="form-note" id="profile-save-status" role="status" aria-live="polite"></p>
      </form>
    `;

    let pendingAvatarUrl = profile.avatar_url;

    document.getElementById("avatar-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById("profile-save-status");
      statusEl.textContent = "Uploading photo...";
      try {
        const currentUser = window.CampusGigsAuth.getCurrentUser();
        pendingAvatarUrl = await uploadAvatar(currentUser.id, file);
        document.getElementById("avatar-preview").src = pendingAvatarUrl;
        document.getElementById("avatar-preview").style.display = "";
        document.getElementById("avatar-placeholder").style.display = "none";
        statusEl.textContent = "Photo uploaded — don't forget to save.";
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });

    document.getElementById("profile-edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById("profile-save-status");
      const currentUser = window.CampusGigsAuth.getCurrentUser();

      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: document.getElementById("p-name").value.trim(),
          university: document.getElementById("p-university").value.trim() || null,
          bio: document.getElementById("p-bio").value.trim() || null,
          skills: document.getElementById("p-skills").value.trim() || null,
          avatar_url: pendingAvatarUrl
        })
        .eq("id", currentUser.id);

      statusEl.textContent = error ? error.message : "Profile saved.";
    });
  }

  /* ---------- Rendering: read-only public profile (someone else's) ---------- */

  function renderPublicProfile(profile) {
    const initials = (profile.full_name || "?").slice(0, 1).toUpperCase();
    profileContent.innerHTML = `
      <div class="profile-avatar-row">
        ${
          profile.avatar_url
            ? `<img src="${profile.avatar_url}" alt="" class="profile-avatar-preview">`
            : `<div class="profile-avatar-placeholder">${escapeHtml(initials)}</div>`
        }
        <div>
          <h2 style="margin:0;">${escapeHtml(profile.full_name)}</h2>
          ${profile.university ? `<p class="form-hint">${escapeHtml(profile.university)}</p>` : ""}
        </div>
      </div>
      ${profile.bio ? `<p class="detail-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${profile.skills ? `<p><strong>Skills:</strong> ${escapeHtml(profile.skills)}</p>` : ""}
      <p class="form-hint">Joined ${new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</p>
      <button class="btn btn-primary btn-block" id="message-from-profile-btn">Message ${escapeHtml(profile.full_name.split(" ")[0] || "them")}</button>
    `;

    document.getElementById("message-from-profile-btn").addEventListener("click", () => {
      closeProfileModal();
      if (window.CampusGigsMessages) {
        window.CampusGigsMessages.openConversationWith(profile.id, profile.full_name);
      }
    });
  }

  /* ---------- Public entry points ---------- */

  async function showOwnProfile() {
    if (!window.CampusGigsAuth.requireLogin()) return;
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    openProfileModal();
    profileContent.innerHTML = `<p>Loading...</p>`;
    const profile = await fetchProfile(currentUser.id);
    if (profile) renderOwnProfileForm(profile);
    else profileContent.innerHTML = `<p>Couldn't load your profile. Try again in a moment.</p>`;
  }

  async function showPublicProfile(userId) {
    const currentUser = window.CampusGigsAuth.getCurrentUser();
    // If viewing your own id, just show the editable version instead.
    if (currentUser && currentUser.id === userId) {
      return showOwnProfile();
    }
    openProfileModal();
    profileContent.innerHTML = `<p>Loading...</p>`;
    const profile = await fetchProfile(userId);
    if (profile) renderPublicProfile(profile);
    else profileContent.innerHTML = `<p>This person doesn't have a profile yet.</p>`;
  }

  openProfileBtn.addEventListener("click", showOwnProfile);

  window.CampusGigsProfile = {
    showOwnProfile,
    showPublicProfile
  };
})();