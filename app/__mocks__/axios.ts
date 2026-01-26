// @ts-nocheck
const mockAxiosInstance = jest.fn(() => Promise.resolve({ data: {} }));

// Mock interceptors
mockAxiosInstance.interceptors = {
    response: {
        use: jest.fn(),
    },
    request: {
        use: jest.fn(),
    },
};

// Mock methods
mockAxiosInstance.get = jest.fn(() => Promise.resolve({ data: {} }));
mockAxiosInstance.post = jest.fn(() => Promise.resolve({ data: {} }));
mockAxiosInstance.put = jest.fn(() => Promise.resolve({ data: {} }));
mockAxiosInstance.delete = jest.fn(() => Promise.resolve({ data: {} }));
mockAxiosInstance.patch = jest.fn(() => Promise.resolve({ data: {} }));
mockAxiosInstance.head = jest.fn(() => Promise.resolve({ data: {} }));

// Mock create method on the default instance
mockAxiosInstance.create = jest.fn(() => mockAxiosInstance);

// Export default
export default mockAxiosInstance;
