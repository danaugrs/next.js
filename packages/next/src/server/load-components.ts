import type {
  AppType,
  DocumentType,
  NextComponentType,
} from '../shared/lib/utils'
import type { ClientReferenceManifest } from '../build/webpack/plugins/flight-manifest-plugin'
import type {
  PageConfig,
  GetStaticPaths,
  GetServerSideProps,
  GetStaticProps,
} from 'next/types'
import type { RouteModule } from './future/route-modules/route-module'

import {
  BUILD_MANIFEST,
  REACT_LOADABLE_MANIFEST,
  CLIENT_REFERENCE_MANIFEST,
  SERVER_REFERENCE_MANIFEST,
} from '../shared/lib/constants'
import { join } from 'path'
import { requirePage } from './require'
import { BuildManifest } from './get-page-files'
import { interopDefault } from '../lib/interop-default'
import { getTracer } from './lib/trace/tracer'
import { LoadComponentsSpan } from './lib/trace/constants'
import { loadManifest } from './load-manifest'
import { wait } from '../lib/wait'
export type ManifestItem = {
  id: number | string
  files: string[]
}

export type ReactLoadableManifest = { [moduleId: string]: ManifestItem }

export type LoadComponentsReturnType = {
  Component: NextComponentType
  pageConfig: PageConfig
  buildManifest: BuildManifest
  subresourceIntegrityManifest?: Record<string, string>
  reactLoadableManifest: ReactLoadableManifest
  clientReferenceManifest?: ClientReferenceManifest
  serverActionsManifest?: any
  Document: DocumentType
  App: AppType
  getStaticProps?: GetStaticProps
  getStaticPaths?: GetStaticPaths
  getServerSideProps?: GetServerSideProps
  ComponentMod: any
  routeModule?: RouteModule
  isAppPath?: boolean
  pathname: string
}

/**
 * Load manifest file with retries, defaults to 3 attempts.
 */
export async function loadManifestWithRetries<T>(
  manifestPath: string,
  attempts = 3
): Promise<T> {
  while (true) {
    try {
      return loadManifest(manifestPath)
    } catch (err) {
      attempts--
      if (attempts <= 0) throw err

      await wait(100)
    }
  }
}

async function loadJSManifest<T>(
  manifestPath: string,
  name: string,
  entryName: string
): Promise<T | undefined> {
  process.env.NEXT_MINIMAL
    ? // @ts-ignore
      __non_webpack_require__(manifestPath)
    : require(manifestPath)
  try {
    return JSON.parse((globalThis as any)[name][entryName]) as T
  } catch (err) {
    return undefined
  }
}

async function loadComponentsImpl({
  distDir,
  pathname,
  isAppPath,
}: {
  distDir: string
  pathname: string
  isAppPath: boolean
}): Promise<LoadComponentsReturnType> {
  let DocumentMod = {}
  let AppMod = {}
  if (!isAppPath) {
    ;[DocumentMod, AppMod] = await Promise.all([
      Promise.resolve().then(() => requirePage('/_document', distDir, false)),
      Promise.resolve().then(() => requirePage('/_app', distDir, false)),
    ])
  }
  const ComponentMod = await Promise.resolve().then(() =>
    requirePage(pathname, distDir, isAppPath)
  )

  // Make sure to avoid loading the manifest for Route Handlers
  const hasClientManifest =
    isAppPath &&
    (pathname.endsWith('/page') ||
      pathname === '/not-found' ||
      pathname === '/_not-found')

  const [
    buildManifest,
    reactLoadableManifest,
    clientReferenceManifest,
    serverActionsManifest,
  ] = await Promise.all([
    loadManifestWithRetries<BuildManifest>(join(distDir, BUILD_MANIFEST)),
    loadManifestWithRetries<ReactLoadableManifest>(
      join(distDir, REACT_LOADABLE_MANIFEST)
    ),
    hasClientManifest
      ? loadJSManifest<ClientReferenceManifest>(
          join(
            distDir,
            'server',
            'app',
            pathname.replace(/%5F/g, '_') +
              '_' +
              CLIENT_REFERENCE_MANIFEST +
              '.js'
          ),
          '__RSC_MANIFEST',
          pathname.replace(/%5F/g, '_')
        )
      : undefined,
    isAppPath
      ? loadManifestWithRetries(
          join(distDir, 'server', SERVER_REFERENCE_MANIFEST + '.json')
        ).catch(() => null)
      : null,
  ])

  const Component = interopDefault(ComponentMod)
  const Document = interopDefault(DocumentMod)
  const App = interopDefault(AppMod)

  const { getServerSideProps, getStaticProps, getStaticPaths, routeModule } =
    ComponentMod

  return {
    App,
    Document,
    Component,
    buildManifest,
    reactLoadableManifest,
    pageConfig: ComponentMod.config || {},
    ComponentMod,
    getServerSideProps,
    getStaticProps,
    getStaticPaths,
    clientReferenceManifest,
    serverActionsManifest,
    isAppPath,
    pathname,
    routeModule,
  }
}

export const loadComponents = getTracer().wrap(
  LoadComponentsSpan.loadComponents,
  loadComponentsImpl
)
