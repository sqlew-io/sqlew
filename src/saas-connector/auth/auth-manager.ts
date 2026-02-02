export class AuthManager {
  constructor(private apiKey: string) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is required');
    }
  }

  getAuthorizationHeader(): string {
    return `Bearer ${this.apiKey}`;
  }
}
