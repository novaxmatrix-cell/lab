// Site settings. The anon key is public by design (Supabase row-level security
// protects the data). NEVER put a service-role key here or anywhere in this repo.
export const CONFIG = {
  url: 'https://lab.novaxmatrix.com/burj/',
  leaderboard: {
    // 'off'  : no leaderboard button
    // 'mock' : UI with made-up data, nothing leaves the device (preview with ?lb=mock)
    // 'live' : Supabase (fill supabaseUrl and anonKey)
    mode: 'off',
    supabaseUrl: '',
    anonKey: '',
  },
  counter: {
    // 'off'  : no player count line
    // 'live' : «صعد البرج X لاعباً غيرك» from Supabase (supabase/counter.sql)
    mode: 'off',
    supabaseUrl: '',
    anonKey: '',
  },
};
