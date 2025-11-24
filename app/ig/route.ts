import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Get the base URL from the request
  const baseUrl = new URL(request.url).origin;

  // Create the redirect URL with UTM parameters
  const redirectUrl = new URL(baseUrl);
  redirectUrl.searchParams.set('utm_source', 'instagram');
  redirectUrl.searchParams.set('utm_medium', 'social');
  redirectUrl.searchParams.set('utm_campaign', 'bio_link');

  // Redirect to the home page with UTM parameters
  return NextResponse.redirect(redirectUrl, { status: 302 });
}
