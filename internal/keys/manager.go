package keys

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "errors"
    "fmt"
    "io"
    "os"
    "path/filepath"
    "strconv"
    "strings"
    "sync"

    "github.com/pulseops/pulseops/internal/store"
)

const (
    storedPrefix = "sshkey:"
)

var (
    ErrMissingSecret = errors.New("encryption secret is required")
    ErrInvalidKey    = errors.New("invalid private key")
)

// Manager handles encrypted SSH key storage and retrieval.
type Manager struct {
    store   *store.Store
    aead    cipher.AEAD
    keyDir  string
    dirOnce sync.Once
}

// NewManager creates a new Manager using the provided secret for encryption.
func NewManager(store *store.Store, secret, dataDir string) (*Manager, error) {
    if secret == "" {
        return nil, ErrMissingSecret
    }

    sum := sha256.Sum256([]byte(secret))
    block, err := aes.NewCipher(sum[:])
    if err != nil {
        return nil, fmt.Errorf("init cipher: %w", err)
    }

    aead, err := cipher.NewGCM(block)
    if err != nil {
        return nil, fmt.Errorf("init gcm: %w", err)
    }

    keyDir := filepath.Join(dataDir, "ssh-keys")

    return &Manager{store: store, aead: aead, keyDir: keyDir}, nil
}

// ReferenceFor returns the stored reference string for a key ID.
func ReferenceFor(id int64) string {
    return fmt.Sprintf("%s%d", storedPrefix, id)
}

// ParseReference extracts the key ID from a stored reference.
func ParseReference(value string) (int64, bool) {
    if !strings.HasPrefix(value, storedPrefix) {
        return 0, false
    }
    idStr := strings.TrimPrefix(value, storedPrefix)
    id, err := strconv.ParseInt(idStr, 10, 64)
    if err != nil {
        return 0, false
    }
    return id, true
}

func (m *Manager) ensureDir() error {
    var err error
    m.dirOnce.Do(func() {
        err = os.MkdirAll(m.keyDir, 0o700)
    })
    return err
}

// SaveKey stores the provided PEM-encoded private key with the given name.
func (m *Manager) SaveKey(name string, pem string) (*store.SSHKeyMeta, error) {
    pem = strings.TrimSpace(pem)
    if pem == "" {
        return nil, errors.New("key material is required")
    }

    if !strings.Contains(pem, "BEGIN") {
        return nil, ErrInvalidKey
    }

    hash := sha256.Sum256([]byte(pem))
    fingerprint := "SHA256:" + base64.StdEncoding.EncodeToString(hash[:])

    encrypted, err := m.encrypt([]byte(pem))
    if err != nil {
        return nil, err
    }

    id, err := m.store.CreateSSHKey(name, fingerprint, encrypted)
    if err != nil {
        return nil, err
    }

    stored, err := m.store.GetSSHKey(id)
    if err != nil {
        return nil, err
    }

    return &stored.SSHKeyMeta, nil
}

// ListKeys returns metadata for all stored keys.
func (m *Manager) ListKeys() ([]store.SSHKeyMeta, error) {
    return m.store.ListSSHKeys()
}

// DeleteKey removes a stored key.
func (m *Manager) DeleteKey(id int64) error {
    return m.store.DeleteSSHKey(id)
}

// GetDecryptedKey returns the decrypted key material.
func (m *Manager) GetDecryptedKey(id int64) (*store.SSHKey, string, error) {
    key, err := m.store.GetSSHKey(id)
    if err != nil {
        return nil, "", err
    }

    plain, err := m.decrypt(key.Encrypted)
    if err != nil {
        return nil, "", fmt.Errorf("decrypt key: %w", err)
    }

    return key, string(plain), nil
}

// ResolvePath returns a path to the private key specified by value. If the value
// references a stored key it is materialized to a temporary file and a cleanup
// function is returned. For filesystem paths, the value is returned as-is.
func (m *Manager) ResolvePath(value string) (string, func(), error) {
    if value == "" {
        return "", func() {}, nil
    }

    id, ok := ParseReference(value)
    if !ok {
        return value, func() {}, nil
    }

    if err := m.ensureDir(); err != nil {
        return "", func() {}, err
    }

    key, pem, err := m.GetDecryptedKey(id)
    if err != nil {
        return "", func() {}, err
    }

    file, err := os.CreateTemp(m.keyDir, fmt.Sprintf("key-%d-*.pem", key.ID))
    if err != nil {
        return "", func() {}, err
    }

    if err := os.Chmod(file.Name(), 0o600); err != nil {
        name := file.Name()
        file.Close()
        os.Remove(name)
        return "", func() {}, err
    }

    if _, err := file.WriteString(pem + "\n"); err != nil {
        name := file.Name()
        file.Close()
        os.Remove(name)
        return "", func() {}, err
    }

    if err := file.Close(); err != nil {
        name := file.Name()
        os.Remove(name)
        return "", func() {}, err
    }

    cleanup := func() {
        os.Remove(file.Name())
    }

    return file.Name(), cleanup, nil
}

func (m *Manager) encrypt(plain []byte) ([]byte, error) {
    nonce := make([]byte, m.aead.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return nil, fmt.Errorf("nonce: %w", err)
    }

    sealed := m.aead.Seal(nil, nonce, plain, nil)
    return append(nonce, sealed...), nil
}

func (m *Manager) decrypt(ciphertext []byte) ([]byte, error) {
    if len(ciphertext) < m.aead.NonceSize() {
        return nil, errors.New("ciphertext too short")
    }

    nonce := ciphertext[:m.aead.NonceSize()]
    data := ciphertext[m.aead.NonceSize():]

    plain, err := m.aead.Open(nil, nonce, data, nil)
    if err != nil {
        return nil, err
    }
    return plain, nil
}
