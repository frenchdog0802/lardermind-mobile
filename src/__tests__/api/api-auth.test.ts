/**
 * API Auth Tests — email/password signin & signup
 */
import { auth } from '../../api/api-auth';
import { api } from '../../api/client';

jest.mock('../../api/client', () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('auth API', () => {
    describe('signin', () => {
        it('should POST to /auth/signin with credentials', async () => {
            mockedApi.post.mockResolvedValue({
                success: true,
                data: { user: { id: '1', name: 'Test', email: 'test@test.com' }, token: 'jwt' },
            });

            await auth.signin('test@test.com', 'password123');

            expect(mockedApi.post).toHaveBeenCalledWith('auth/signin', {
                email: 'test@test.com',
                password: 'password123',
            });
        });

        it('should return success response', async () => {
            const mockResponse = {
                success: true,
                data: { user: { id: '1', name: 'Test', email: 'test@test.com' }, token: 'jwt' },
            };
            mockedApi.post.mockResolvedValue(mockResponse);

            const result = await auth.signin('test@test.com', 'password');

            expect(result.success).toBe(true);
            expect(result.data?.token).toBe('jwt');
        });
    });

    describe('signup', () => {
        it('should POST to /auth/signup with user data and password', async () => {
            mockedApi.post.mockResolvedValue({
                success: true,
                data: { user: { id: '1', name: 'New', email: 'new@test.com' }, token: 'jwt' },
            });

            const userData = { id: '', name: 'New', email: 'new@test.com', first_name: 'New', last_name: 'User' };
            await auth.signup(userData, 'password123');

            expect(mockedApi.post).toHaveBeenCalledWith('auth/signup', {
                ...userData,
                password: 'password123',
            });
        });
    });

    describe('googleLogin', () => {
        it('should POST to /auth/google-login with Google ID token', async () => {
            mockedApi.post.mockResolvedValue({
                success: true,
                data: { user: { id: '1', name: 'G', email: 'g@test.com' }, token: 'jwt' },
            });

            await auth.googleLogin('google-id-token');

            expect(mockedApi.post).toHaveBeenCalledWith('auth/google-login', {
                token: 'google-id-token',
            });
        });
    });
});
