//==========================================================
// P7 - AI Assisted Crop Type Mapping
// Study Area: Punjab & Haryana Agricultural Belt
//==========================================================

// Area of Interest
// Filter only Punjab and Haryana
var aoi = table.filter(
  ee.Filter.inList('NAME_1', ['Punjab', 'Haryana'])
);

Map.centerObject(aoi, 7);

Map.addLayer(aoi, {
  color: 'red'
}, 'Study Area');
//==========================================================
// CLOUD MASK FUNCTION
//==========================================================

function maskS2(image) {
  var scl = image.select('SCL');

  var mask = scl.neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  return image.updateMask(mask);
}

//==========================================================
// LOAD SENTINEL-2 HARMONIZED
//==========================================================

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2023-01-01', '2023-12-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2);

print("Number of Images:", s2.size());

// Create RGB Composite
var image = s2.median().clip(aoi);

Map.addLayer(image, {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 3000
}, 'RGB Composite');
//==========================================================
// CREATE SEASONAL COMPOSITES
//==========================================================

// Kharif (June - October)
var kharif = s2
  .filterDate('2023-06-01', '2023-10-31')
  .median()
  .clip(aoi);

// Rabi (November - March)
var rabi = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2023-11-01', '2024-03-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',20))
  .map(maskS2)
  .median()
  .clip(aoi);

print('Kharif Composite', kharif);
print('Rabi Composite', rabi);
//==========================================================
// NDVI CALCULATION
//==========================================================

var ndviK = kharif.normalizedDifference(['B8','B4'])
                  .rename('NDVI_K');

var ndviR = rabi.normalizedDifference(['B8','B4'])
                .rename('NDVI_R');

Map.addLayer(
    ndviK,
    {
      min:0,
      max:1,
      palette:['brown','yellow','green']
    },
    'NDVI Kharif'
);

Map.addLayer(
    ndviR,
    {
      min:0,
      max:1,
      palette:['brown','yellow','green']
    },
    'NDVI Rabi'
);
//==========================================================
// FEATURE STACK
//==========================================================

var stack = ee.Image.cat([

    ndviK,
    ndviR,

    kharif.select(['B2','B3','B4','B8']),

    rabi.select(['B2','B3','B4','B8'])

]);

print("Feature Stack", stack);
//==========================================================
// DYNAMIC WORLD TRAINING DATA
//==========================================================

// Load Dynamic World
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoi)
    .filterDate('2023-01-01', '2023-12-31')
    .select('label')
    .mode();

// Display for reference
Map.addLayer(dw, {}, 'Dynamic World');

// Cropland = class 4
var cropland = dw.eq(4);

// Show cropland
Map.addLayer(
    cropland.selfMask(),
    {palette:['00FF00']},
    'Cropland Mask'
);
//==========================================================
// CROPPING PATTERN CLASSIFICATION
//==========================================================

// Thresholds
var kharifCrop = ndviK.gt(0.4);
var rabiCrop    = ndviR.gt(0.4);
// Double Cropping
var doubleCrop = kharifCrop.and(rabiCrop);

// Single Cropping
var singleCrop = kharifCrop.neq(rabiCrop);
// Fallow Land
var fallow = kharifCrop.not().and(rabiCrop.not());
// Create classified image
var cropPattern = ee.Image(0)
  .where(singleCrop, 1)
  .where(doubleCrop, 2)
  .where(fallow, 3)
  .clip(aoi);
// Display
Map.addLayer(
cropPattern.selfMask(),
{
min:1,
max:3,
palette:[
'FFFF00', // Single Crop
'00AA00', // Double Crop
'964B00'  // Fallow
]
},
'Cropping Pattern'
);

print("Cropping Pattern", cropPattern);

//==========================================================
// AREA STATISTICS (FAST VERSION)
//==========================================================

var pixelArea = ee.Image.pixelArea().divide(1e6); // sq km

// Single Crop
var singleArea = pixelArea.updateMask(cropPattern.eq(1))
.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: 100,
  maxPixels: 1e13,
  tileScale: 16
});

// Double Crop
var doubleArea = pixelArea.updateMask(cropPattern.eq(2))
.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: 100,
  maxPixels: 1e13,
  tileScale: 16
});

// Fallow
var fallowArea = pixelArea.updateMask(cropPattern.eq(3))
.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: aoi,
  scale: 100,
  maxPixels: 1e13,
  tileScale: 16
});

print('Single Crop Area (sq km)', singleArea);
print('Double Crop Area (sq km)', doubleArea);
print('Fallow Area (sq km)', fallowArea);

//==========================================================
// VECTOR CONVERSION
//==========================================================

var cropVector = cropPattern.reduceToVectors({
  geometry: aoi.geometry(),
  scale: 100,
  geometryType: 'polygon',
  labelProperty: 'Class',
  eightConnected: false,
  maxPixels: 1e13,
  tileScale: 16
});

Map.addLayer(cropVector, {}, 'Crop Pattern Vector');

print('Vector Output', cropVector);
//==========================================================
// EXPORT CROPPING PATTERN
//==========================================================

Export.image.toDrive({
  image: cropPattern,
  description: 'Punjab_Haryana_CroppingPattern',
  folder: 'GEE_Exports',
  fileNamePrefix: 'CroppingPattern',
  region: aoi.geometry(),
  scale: 10,
  maxPixels: 1e13
});
//==========================================================
// EXPORT VECTOR
//==========================================================

Export.table.toDrive({
  collection: cropVector,
  description: 'Punjab_Haryana_Vector',
  folder: 'GEE_Exports',
  fileFormat: 'SHP'
});// Google Earth Engine Script
