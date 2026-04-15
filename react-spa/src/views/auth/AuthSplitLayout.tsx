import { ShieldCheck } from 'lucide-react';

interface AuthSplitLayoutProps {
  heroTitle: string;
  children: React.ReactNode;
}

export function AuthSplitLayout({ heroTitle, children }: AuthSplitLayoutProps) {
  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center overflow-hidden bg-slate-900 px-12 xl:px-24 relative">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        <div className="relative z-10">
          <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/50">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight">{heroTitle}</h1>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-slate-50 p-8 lg:w-1/2">
        {children}
      </div>
    </div>
  );
}
