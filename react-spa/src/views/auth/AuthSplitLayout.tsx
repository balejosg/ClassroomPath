import { CLASSROOMPATH_BRAND_ASSETS } from '../../brand-assets';

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

        <div className="relative z-10 max-w-xl">
          <img
            src={CLASSROOMPATH_BRAND_ASSETS.logoHorizontal}
            alt="ClassroomPath"
            className="mb-10 h-12 w-auto rounded-md bg-white/95 px-3 py-2 shadow-sm"
          />
          <img
            src={CLASSROOMPATH_BRAND_ASSETS.authHero}
            alt=""
            aria-hidden="true"
            className="mb-10 aspect-[4/3] w-full max-w-lg rounded-lg object-cover shadow-2xl shadow-slate-950/40"
          />
          <h1 className="text-4xl font-bold text-white leading-tight">{heroTitle}</h1>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-slate-50 p-8 lg:w-1/2">
        {children}
      </div>
    </div>
  );
}
