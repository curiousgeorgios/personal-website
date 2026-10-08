// One photo's place names for photos:prepare (spec 7.2, ADR-0022). Reads the image's GPS with ImageIO and asks Apple's
// geocoder through MapKit; prints names only. The coordinates go to Apple's geocoding service and nowhere else: this
// process never prints, logs or writes them. --has-gps only says whether there are any, and asks nobody.
//
// Exit codes (never the error text): 0 with the names, or "null" for no GPS or a place the geocoder has no answer for;
// 75 when trying again later may work (offline, rate limited, the service down); 1 for what will happen every time
// (an unusable GPS position, a request that cannot be made); 2 for bad usage.
import CoreLocation
import Foundation
import ImageIO
import MapKit

func gpsLocation(_ url: URL) -> CLLocation? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
          let latitude = gps[kCGImagePropertyGPSLatitude] as? Double,
          let longitude = gps[kCGImagePropertyGPSLongitude] as? Double else { return nil }
    let south = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S"
    let west = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W"
    return CLLocation(latitude: south ? -latitude : latitude, longitude: west ? -longitude : longitude)
}

let arguments = CommandLine.arguments
let checkOnly = arguments.count == 3 && arguments[1] == "--has-gps"
guard arguments.count == 2 || checkOnly else {
    fputs("usage: photo-place [--has-gps] image\n", stderr)
    exit(2)
}
guard let location = gpsLocation(URL(fileURLWithPath: arguments[arguments.count - 1])) else {
    print(checkOnly ? "false" : "null")
    exit(0)
}
if checkOnly {
    print("true")
    exit(0)
}
// A corrupt or out-of-range position will fail on every run: say so, and let prepare list the post for review
guard CLLocationCoordinate2DIsValid(location.coordinate),
      let request = MKReverseGeocodingRequest(location: location) else {
    fputs("Cannot make a geocoding request\n", stderr)
    exit(1)
}
request.preferredLocale = Locale(identifier: "en_AU")
do {
    let items = try await request.mapItems
    // The map item's placemark is the one MapKit object with all five names the city map needs; it carries a
    // deprecation note in the macOS 26 SDK, so swiftc prints one warning for this line
    guard let placemark = items.first?.placemark else {
        print("null")
        exit(0)
    }
    // The geocoder can name a landmark as the sub-locality ("Sydney Opera House and Botanical Garden"); an area is a
    // neighbourhood, so drop one that contains any of the placemark's areas of interest. Done here so the landmark's
    // name never reaches the cache. (Not placemark.name, which can be a street address.)
    let interests = placemark.areasOfInterest ?? []
    let subLocality = placemark.subLocality.flatMap { name in
        interests.contains { name.localizedCaseInsensitiveContains($0) } ? nil : name
    }
    let names: [String: Any] = [
        "subLocality": subLocality ?? NSNull(),
        "locality": placemark.locality ?? NSNull(),
        "subAdministrativeArea": placemark.subAdministrativeArea ?? NSNull(),
        "administrativeArea": placemark.administrativeArea ?? NSNull(),
        "isoCountryCode": placemark.isoCountryCode ?? NSNull(),
    ]
    let data = try JSONSerialization.data(withJSONObject: names, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    // Fixed strings only: an error's description can carry the position
    if let mapError = error as? MKError {
        switch mapError.code {
        case .placemarkNotFound:
            print("null")
            exit(0)
        case .loadingThrottled, .serverFailure:
            fputs("Geocoding unavailable, try again later\n", stderr)
            exit(75)
        default:
            break
        }
    }
    if let locationError = error as? CLError, locationError.code == .geocodeFoundNoResult {
        print("null")
        exit(0)
    }
    if (error as NSError).domain == NSURLErrorDomain {
        fputs("Geocoding unavailable, try again later\n", stderr)
        exit(75)
    }
    fputs("Geocoding failed\n", stderr)
    exit(1)
}
