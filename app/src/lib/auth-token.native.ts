import * as SecureStore from 'expo-secure-store';

const key = 'aldus.session';

export const getToken = () => SecureStore.getItemAsync(key);
export const setToken = (token: string) => SecureStore.setItemAsync(key, token);
export const clearToken = () => SecureStore.deleteItemAsync(key);
