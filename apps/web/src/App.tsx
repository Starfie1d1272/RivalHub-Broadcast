export const surfaceDefinitions = [
  {
    id: 'program',
    path: '/program',
    title: 'Program',
    description: '节目输出占位页面。真实 scene 与 HUD 属于后续 milestone。',
  },
  {
    id: 'operator',
    path: '/operator',
    title: 'Operator',
    description: '导播控制占位页面。真实运行控制属于后续 milestone。',
  },
  {
    id: 'debug',
    path: '/debug',
    title: 'Debug',
    description: '诊断 surface 占位页面。真实 telemetry/debug projection 属于后续 milestone。',
  },
] as const;

export type SurfaceDefinition = (typeof surfaceDefinitions)[number];

export function surfaceForPath(pathname: string): SurfaceDefinition {
  return surfaceDefinitions.find((surface) => surface.path === pathname) ?? surfaceDefinitions[0];
}

export function SurfacePage({ surface }: { readonly surface: SurfaceDefinition }) {
  return (
    <main className="shell" data-surface={surface.id}>
      <header className="shell__header">
        <p className="shell__eyebrow">RivalHub Broadcast</p>
        <h1>{surface.title}</h1>
        <p>{surface.description}</p>
      </header>

      <nav aria-label="Broadcast surfaces" className="shell__nav">
        {surfaceDefinitions.map((definition) => (
          <a
            aria-current={definition.path === surface.path ? 'page' : undefined}
            href={definition.path}
            key={definition.path}
          >
            {definition.title}
          </a>
        ))}
      </nav>

      <p className="shell__note">工程 shell 已就绪；本页面暂不连接运行时数据。</p>
    </main>
  );
}

export function App() {
  return <SurfacePage surface={surfaceForPath(window.location.pathname)} />;
}
