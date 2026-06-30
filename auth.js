/* =========================================================
   CAMPUSGIGS — AUTH (frontend, powered by Supabase Auth)
   Handles: the account modal (sign up / log in tabs), email
   + password auth, "who am I" on page load, logging out, and
   Google sign-in — all via Supabase Auth, called directly
   from the browser. No custom backend auth server needed.

   Requires supabase-config.js to be loaded first (defines
   window.supabaseClient).
   ========================================================= */

(function () {
  "use strict";

  const supabase = window.supabaseClient;

  /* ---------- State ---------- */
  let currentUser = null; // shape: { id, name, email } or null

  /* ---------- DOM references ---------- */
  const accountModal = document.getElementById("account-modal");
  const openAccountBtn = document.getElementById("open-account-form");
  const closeAccountBtn = document.getElementById("close-account-form");

  const tabSignup = document.getElementById("tab-signup");
  const tabLogin = document.getElementById("tab-login");
  const signupForm = document.getElementById("signup-form");
  const loginForm = document.getElementById("login-form");
  const signupError = document.getElementById("signup-error");
  const loginError = document.getElementById("login-error");

  const googleButton = document.getElementById("google-signin-button");
  const googleFallback = document.getElementById("google-signin-fallback");

  /* ---------- Modal open/close + tab switching ---------- */

  function openAccountModal() {
    accountModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeAccountModal() {
    accountModal.hidden = true;
    document.body.style.overflow = "";
    signupError.textContent = "";
    loginError.textContent = "";
  }

  function showSignupTab() {
    tabSignup.classList.add("is-active");
    tabLogin.classList.remove("is-active");
    tabSignup.setAttribute("aria-selected", "true");
    tabLogin.setAttribute("aria-selected", "false");
    signupForm.hidden = false;
    loginForm.hidden = true;
  }

  function showLoginTab() {
    tabLogin.classList.add("is-active");
    tabSignup.classList.remove("is-active");
    tabLogin.setAttribute("aria-selected", "true");
    tabSignup.setAttribute("aria-selected", "false");
    loginForm.hidden = false;
    signupForm.hidden = true;
  }

  openAccountBtn.addEventListener("click", () => {
    // If already logged in, the button instead acts as a log-out shortcut.
    if (currentUser) {
      logout();
    } else {
      openAccountModal();
    }
  });
  closeAccountBtn.addEventListener("click", closeAccountModal);
  accountModal.addEventListener("click", (e) => {
    if (e.target === accountModal) closeAccountModal();
  });
  tabSignup.addEventListener("click", showSignupTab);
  tabLogin.addEventListener("click", showLoginTab);

  /* ---------- Translating a Supabase session into our currentUser shape ---------- */

  function userFromSupabaseUser(supabaseUser) {
    if (!supabaseUser) return null;
    return {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name:
        supabaseUser.user_metadata?.name ||
        supabaseUser.user_metadata?.full_name ||
        supabaseUser.email.split("@")[0]
    };
  }

  /* ---------- Reflecting login state in the header ---------- */

  function reflectLoggedInState() {
    if (currentUser) {
      openAccountBtn.textContent = `Log out (${currentUser.name.split(" ")[0]})`;
    } else {
      openAccountBtn.textContent = "Log in";
    }
    // Let other scripts (script.js) know auth state changed.
    document.dispatchEvent(new CustomEvent("campusgigs:auth-changed", { detail: { user: currentUser } }));
  }

  /* ---------- Sign up ---------- */

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signupError.textContent = "";

    const name = document.getElementById("su-name").value.trim();
    const email = document.getElementById("su-email").value.trim();
    const password = document.getElementById("su-password").value;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } } // stored as user_metadata.name
    });

    if (error) {
      signupError.textContent = error.message;
      return;
    }

    if (!data.session) {
      // Email confirmation is turned on in this Supabase project:
      // there's no active session yet until the user clicks the link.
      signupError.textContent = "Check your email to confirm your account, then log in.";
      showLoginTab();
      signupForm.reset();
      return;
    }

    // Email confirmation is off, or auto-confirmed: session is active immediately.
    currentUser = userFromSupabaseUser(data.user);
    reflectLoggedInState();
    closeAccountModal();
    signupForm.reset();
  });

  /* ---------- Log in ---------- */

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";

    const email = document.getElementById("li-email").value.trim();
    const password = document.getElementById("li-password").value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      loginError.textContent = error.message;
      return;
    }

    currentUser = userFromSupabaseUser(data.user);
    reflectLoggedInState();
    closeAccountModal();
    loginForm.reset();
  });

  /* ---------- Log out ---------- */

  async function logout() {
    await supabase.auth.signOut();
    currentUser = null;
    reflectLoggedInState();
  }

  /* ---------- Google sign-in (Supabase OAuth redirect flow) ---------- */
  // This redirects the whole page to Google, then back to this same
  // page once the person approves. onAuthStateChange (below) picks up
  // the new session automatically when the page reloads.

  googleButton.addEventListener("click", async () => {
    signupError.textContent = "";
    loginError.textContent = "";

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href }
    });

    if (error) {
      // Most likely cause: the Google provider isn't enabled yet in
      // Authentication -> Providers in the Supabase dashboard.
      googleFallback.hidden = false;
      const target = loginForm.hidden ? signupError : loginError;
      target.textContent = error.message;
    }
  });

  /* ---------- Expose a tiny public API for script.js ---------- */

  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

  window.CampusGigsAuth = {
    getCurrentUser: () => currentUser,
    requireLogin: () => {
      if (currentUser) return true;
      openAccountModal();
      return false;
    },
    // Resolves once the initial session check has finished, so other
    // scripts can safely call getCurrentUser() right after await-ing
    // this instead of racing the async auth check on page load.
    ready: () => readyPromise
  };

  /* ---------- Init ---------- */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !accountModal.hidden) closeAccountModal();
  });

  // Fires immediately on load with the current session (if any), and again
  // on every future sign-in, sign-out, or token refresh. This replaces the
  // old manual "/api/auth/me" check entirely.
  let hasResolvedInitialSession = false;
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = userFromSupabaseUser(session?.user ?? null);
    reflectLoggedInState();
    if (!hasResolvedInitialSession) {
      hasResolvedInitialSession = true;
      resolveReady();
    }
  });
})();