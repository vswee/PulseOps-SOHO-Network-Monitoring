package auth

import (
	"context"
	"net/http"

	"github.com/pulseops/pulseops/internal/store"
)

// ContextKey is used for context values
type ContextKey string

const (
	// UserContextKey is the key for storing user in context
	UserContextKey ContextKey = "user"
	// SessionContextKey is the key for storing session in context
	SessionContextKey ContextKey = "session"
	// SessionCookieName is the name of the session cookie
	SessionCookieName = "pulseops_session"
)

// AuthState represents the current authentication state
type AuthState struct {
	SetupCompleted bool        `json:"setup_completed"`
	Authenticated  bool        `json:"authenticated"`
	User           *store.User `json:"user,omitempty"`
}

// Middleware provides authentication middleware functionality
type Middleware struct {
	store *store.Store
}

// NewMiddleware creates a new authentication middleware
func NewMiddleware(store *store.Store) *Middleware {
	return &Middleware{store: store}
}

// GetAuthState returns the current authentication state for a request
func (m *Middleware) GetAuthState(r *http.Request) (*AuthState, error) {
	setupCompleted, err := m.store.IsSetupCompleted()
	if err != nil {
		return nil, err
	}

	state := &AuthState{
		SetupCompleted: setupCompleted,
		Authenticated:  false,
	}

	// If setup is not completed, return early
	if !setupCompleted {
		return state, nil
	}

	// Check for session cookie
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return state, nil // No session cookie
	}

	// Validate session
	session, err := m.store.GetSession(cookie.Value)
	if err != nil {
		return state, nil // Invalid session
	}

	// Get user
	user, err := m.store.GetUserByID(session.UserID)
	if err != nil {
		return state, nil // User not found
	}

	state.Authenticated = true
	state.User = user

	return state, nil
}

// RequireSetup middleware ensures setup is completed
func (m *Middleware) RequireSetup(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authState, err := m.GetAuthState(r)
		if err != nil {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		if !authState.SetupCompleted {
			http.Redirect(w, r, "/setup", http.StatusFound)
			return
		}

		next(w, r)
	}
}

// RequireAuth middleware ensures user is authenticated
func (m *Middleware) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authState, err := m.GetAuthState(r)
		if err != nil {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		if !authState.SetupCompleted {
			http.Redirect(w, r, "/setup", http.StatusFound)
			return
		}

		if !authState.Authenticated {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}

		// Add user and session to context
		ctx := context.WithValue(r.Context(), UserContextKey, authState.User)
		next(w, r.WithContext(ctx))
	}
}

// GetUserFromContext retrieves the user from request context
func GetUserFromContext(r *http.Request) *store.User {
	if user, ok := r.Context().Value(UserContextKey).(*store.User); ok {
		return user
	}
	return nil
}

// SetSessionCookie sets the session cookie
func SetSessionCookie(w http.ResponseWriter, sessionID string) {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   false, // Set to true in production with HTTPS
		SameSite: http.SameSiteLaxMode,
		MaxAge:   24 * 60 * 60, // 24 hours
	}
	http.SetCookie(w, cookie)
}

// ClearSessionCookie clears the session cookie
func ClearSessionCookie(w http.ResponseWriter) {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	}
	http.SetCookie(w, cookie)
}
