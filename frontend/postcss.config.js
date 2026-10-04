import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
