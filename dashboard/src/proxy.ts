// Next.js 16 renamed the `middleware` file convention to `proxy` (the function
// itself is unchanged — @clerk/nextjs's clerkMiddleware() still returns a
// standard request handler; only the file name and export changed). See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// and this repo's own AGENTS.md warning before assuming older conventions apply.
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
