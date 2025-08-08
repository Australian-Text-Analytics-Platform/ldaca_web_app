import { 
  User, 
  AuthInfoResponse, 
  GoogleAuthResponse 
} from '../types';

// Import the API base URL configuration
const getApiBase = () => {
  const hostname = window.location.hostname;
  const origin = window.location.origin;
  
  if (hostname === 'ldaca.sguo.org') {
    return `${origin}/api`;
  }
  
  if (hostname === 'localhost' && window.location.port === '3000') {
    return 'http://localhost:8001/api';
  }
  
  return process.env.NODE_ENV === 'production' 
    ? `${origin}/api`
    : 'http://localhost:8001/api';
};

const API_BASE = getApiBase();

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const authApi = {
  /**
   * Get auth info - main endpoint that tells frontend everything it needs
   */
  async getAuthInfo(): Promise<AuthInfoResponse> {
    const response = await fetch(`${API_BASE}/auth/`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch auth information');
    }
    
    return response.json();
  },

  /**
   * Authenticate with Google OAuth
   */
  async authenticateWithGoogle(idToken: string): Promise<GoogleAuthResponse> {
    const response = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id_token: idToken }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Google authentication failed');
    }

    return response.json();
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    const response = await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Logout failed');
    }
  },

  /**
   * Get detailed user information
   */
  async getCurrentUserDetails(): Promise<User> {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user details');
    }

    return response.json();
  }
};
