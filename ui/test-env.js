// Quick test to see if Vite loads the env var
console.log('VITE_GOOGLE_CLIENT_ID:', import.meta.env.VITE_GOOGLE_CLIENT_ID);
console.log('All VITE vars:', Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')));
