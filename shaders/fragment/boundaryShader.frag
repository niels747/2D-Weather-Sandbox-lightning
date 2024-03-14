#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D vortForceTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D precipFeedbackTex;

uniform float dryLapse;
uniform float evapHeat;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float vorticity;
uniform float waterEvaporation;
uniform float landEvaporation;
uniform float waterWeight;
uniform vec4 initial_Tv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

uniform float IR_rate;
uniform float sunAngle;

uniform float iterNum; // used as seed for random function

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

#include "common.glsl"

#define minimalFireVegitation 10

#define wallVerticalInfluence 1 // 2 How many cells above the wall surface effects like heating and evaporation are applied
/*
#define wallManhattanInfluence 0 // 2 How many cells from the nearest wall effects like smoothing and drag are applied
#define exchangeRate 0.001       // Rate of smoothing near surface



void exchangeWith(vec2 texCoord) // exchange temperature and water
{
  base[3] -= (base[3] - texture(baseTex, texCoord)[3]) * exchangeRate;
  water[0] -= (water[0] - texture(waterTex, texCoord)[0]) * exchangeRate;
}
*/
void main()
{
  base = texture(baseTex, texCoord);
  water = texture(waterTex, texCoord);

  vec4 precipFeedback = texture(precipFeedbackTex, texCoord);

  float realTemp = potentialToRealT(base[3]);

  wall = texture(wallTex, texCoord);
  ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
  ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

  vec4 light = texture(lightTex, texCoord);

  bool nextToWall = false;

  wall[VERT_DISTANCE] = wallX0Ym[VERT_DISTANCE] + 1;   // height above ground is counted

  if (wall[DISTANCE] != 0) {                           // is fluid, not wall

    wall[TYPE] = wallX0Ym[TYPE];                       // copy wall type from wall below

    base[TEMPERATURE] += light[NET_HEATING] * IR_rate; // IR heating/cooling effect

    base[TEMPERATURE] += precipFeedback[HEAT];         // rain cools air and riming heats air
    water[TOTAL] += precipFeedback[VAPOR];             // rain adds water to air
    // recalculate cloud water after changing total water
    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0);
    // 0.004 for rain visualisation
    water[PRECIPITATION] = max(water[PRECIPITATION] * 0.998 - 0.00005 + precipFeedback[MASS] * 0.008, 0.0);

    // rain removes smoke from air
    water[SMOKE] /= 1. + max(-precipFeedback[VAPOR] * 0.3, 0.0) + precipFeedback[MASS] * 0.003; // rain formation in clouds removes smoke
                                                                                                // quickly , falling rain slower
    water[SMOKE] -= precipFeedback[MASS] * 0.0002;                                              // linearly to remove last little bit


    water[SMOKE] -= max((water[SMOKE] - 4.0) * 0.01, 0.); // dissipate fire color to smoke

    water[SMOKE] = max(water[SMOKE], 0.0);                // snow and smoke can't go below 0

    // GRAVITY
    // temperature is calculated for Vy location
    vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

#define gravMult 0.0001 // 0.0001 0.0005

    // gravity for convection interpolated between this and above cell to fix wierd waves
    // Because vertical velocity is defined at the top of the cell while temperature is defined in it's center.
    float gravityForce = ((base[TEMPERATURE] + baseX0Yp[TEMPERATURE]) * 0.5 - (getInitialT(int(fragCoord.y)) + getInitialT(int(fragCoord.y) + 1)) * 0.5) * gravMult;

    // float gravityForce = (base[3] - initial_T[int(fragCoord.y)]) * gravMult;

    gravityForce -= water[CLOUD] * gravMult * waterWeight;         // cloud water weight added to gravity force

    gravityForce -= precipFeedback[MASS] * gravMult * waterWeight; // precipitation weigth added to gravity force

    base[VY] += gravityForce;

    // base.x += sin(texCoord.x * PI * 2.0 + iterNum * 0.000005) * (1. - texCoord.y) * 0.00015; // phantom force to simulate high and low pressure areas

    float snowCover = 0.;

    if (wallX0Ym[DISTANCE] == 0) {                       // below is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                                // dist to nearest wall = 1
                                                         // wall[TYPE] = wallX0Ym[TYPE];                       // copy wall type from wall below
      snowCover = texture(waterTex, texCoordX0Ym)[SNOW]; // get snow amount
      wall[VERT_DISTANCE] = 1;                           // directly above ground
    }

    if (wallXmY0[DISTANCE] == 0) {            // left is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                     // dist to nearest wall = 1
                                              //  wall[TYPE] = wallXmY0[TYPE];

      if (wallXmY0[TYPE] == WALLTYPE_WATER) { // if left is water, build a dyke
        wall[TYPE] = WALLTYPE_LAND;
        wall[DISTANCE] = 0;
      }

      if (wallXpY0[DISTANCE] == 0)            // left and right is wall, make this wall to fill narrow gaps
        wall[DISTANCE] = 0;
    } else if (wallXpY0[DISTANCE] == 0) {     // right is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                     // dist to nearest wall = 1
                                              //  wall[TYPE] = wallXpY0[TYPE];

      if (wallXpY0[TYPE] == WALLTYPE_WATER) { // if right is water, build a dyke
        wall[TYPE] = WALLTYPE_LAND;
        wall[DISTANCE] = 0;
      }
    }
    if (wallX0Yp[DISTANCE] == 0) {                                                                                                          // above is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                                                                                                                   // dist to nearest wall = 1
                                                                                                                                            // wall[TYPE] = wallX0Yp[TYPE];

      if (texCoord.y < 0.99 && (wallX0Yp[TYPE] == WALLTYPE_LAND || wallX0Yp[TYPE] == WALLTYPE_URBAN || wallX0Yp[TYPE] == WALLTYPE_WATER)) { // Fill in land and sea below
        wall[DISTANCE] = 0;                                                                                                                 //  set this to wall
      }
    }


    // if(abs(base.x) > 0.0040 && abs(base.y) > 0.0040){
    //  sample vorticity force
    vec2 vortForceX0Y0 = texture(vortForceTex, texCoord).xy;
    vec2 vortForceXmY0 = texture(vortForceTex, texCoordXmY0).xy;
    vec2 vortForceX0Ym = texture(vortForceTex, texCoordX0Ym).xy;

    // apply vorticity force
    base.xy += vec2(vortForceX0Y0.x + vortForceX0Ym.x, vortForceX0Y0.y + vortForceXmY0.y) * vorticity;
    //}

    if (!nextToWall) { // not next to wall

      // find nearest wall
      int nearest = 255;
      int nearestType = 0;
      if (wallX0Ym[DISTANCE] < nearest) {
        nearest = wallX0Ym[DISTANCE];
        nearestType = wallX0Ym[TYPE];
      }
      if (wallX0Yp[DISTANCE] < nearest) {
        nearest = wallX0Yp[DISTANCE];
        nearestType = wallX0Yp[TYPE];
      }
      if (wallXmY0[DISTANCE] < nearest) {
        nearest = wallXmY0[DISTANCE];
        nearestType = wallXmY0[TYPE];
      }
      if (wallXpY0[DISTANCE] < nearest) {
        nearest = wallXpY0[DISTANCE];
        nearestType = wallXpY0[TYPE];
      }

      wall[DISTANCE] = nearest + 1; // add one to dist to wall
                                    // wall[TYPE] = nearestType;     // type = type of nearest wall
    }

    /*
        if (wall[1] <= wallManhattanInfluence) { // within manhattan range of wall

          float influenceDevider = float(wallManhattanInfluence); // devide by how many cells it's aplied to

          // base[0] *= 0.999; // surface drag

          float realTemp = potentialToRealT(base[3]);

          // Smoothing near surface

          if (wallX0Yp[1] != 0 && wallX0Yp[1] <= wallManhattanInfluence) { // above
            exchangeWith(texCoordX0Yp);
          }

          if (wallX0Ym[1] != 0 && wallX0Ym[1] <= wallManhattanInfluence) { // below
            exchangeWith(texCoordX0Ym);
          }

          if (wallXmY0[1] != 0 && wallXmY0[1] <= wallManhattanInfluence) { // left
            exchangeWith(texCoordXmY0);
          }

          if (wallXpY0[1] != 0 && wallXpY0[1] <= wallManhattanInfluence) { // right
            exchangeWith(texCoordXpY0);
          }
        }*/

    if (wall[VERT_DISTANCE] <= wallVerticalInfluence) {      // within vertical range of wall

      float influenceDevider = float(wallVerticalInfluence); // devide by how many cells it's aplied to

      wall[VEGETATION] = wallX0Ym[VEGETATION];               // vegetation is copied from below

      // base[2] *= 0.995; // 0.999

      // base[2]  += 0.001; // add air pressure at the suface. makes air rise everywhere and creates huge cells

      switch (wall[TYPE]) {
      case WALLTYPE_URBAN:
        water[SMOKE] += 0.00001; // City produces smog
      case WALLTYPE_LAND:

        float lightPower = lightHeatingConst * light[0] * cos(sunAngle); // Light power per horizontal surface area

        lightPower *= map_rangeC(snowCover, fullWhiteSnowHeight, 0.0, 1. - ALBEDO_SNOW, 1.);

        base[TEMPERATURE] += lightPower / influenceDevider;                                                                                       // sun heating land

        float evaporation = max((maxWater(realTemp) - water[TOTAL]) * landEvaporation * (float(wall[VEGETATION]) / 127.) / influenceDevider, 0.); // water evaporating from land proportional to vegitation

        water[TOTAL] += evaporation;
        base[TEMPERATURE] -= evaporation * evapHeat;

        if (wall[VEGETATION] < 10) {                                                      // Dry desert area
          water[SMOKE] = min(water[SMOKE] + (max(abs(base[VX]) - 0.12, 0.) * 0.15), 2.4); // Dust blowing up with wind
        }
        break;
      case WALLTYPE_WATER:
        float LocalWaterTemperature = texture(baseTex, texCoordX0Ym)[TEMPERATURE];                                       // water temperature
        base[TEMPERATURE] += (LocalWaterTemperature - realTemp - 1.0) / influenceDevider * 0.0002;                       // air heated or cooled by water

        water[TOTAL] += max((maxWater(LocalWaterTemperature) - water[TOTAL]) * waterEvaporation / influenceDevider, 0.); // water evaporating

        break;
      case WALLTYPE_FIRE:
        if (wall[VERT_DISTANCE] == 1) {         // forest fire & one above surface
          float fireIntensity = float(wall[VEGETATION]) * 0.00015;
          base[TEMPERATURE] += fireIntensity;   // heat
          water[SMOKE] += fireIntensity * 2.0;  // smoke
          water[TOTAL] += fireIntensity * 0.50; // extra water from burning trees, both from water in the wood and from burning of hydrogen and hydrocarbons
        }
      }
    }

  } else { // this is wall


    wall[VERT_DISTANCE] = wallX0Yp[VERT_DISTANCE] - 1; // height below ground is counted

    if (wall[VERT_DISTANCE] < 0) {                     // below surface
      if (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN) {
        water.ba = texture(waterTex, texCoordX0Yp).ba; // soil moisture and snow is copied from above
        wall[VEGETATION] = wallX0Yp[VEGETATION];       // vegetation is copied from above
      }

      if (wallX0Yp[DISTANCE] == 0) {                                       // if above is wall
        if (wallX0Yp[TYPE] != WALLTYPE_WATER) {                            // above is not water
          wall[TYPE] = wallX0Yp[TYPE];                                     // copy walltype from above
        } else if (wall[TYPE] == WALLTYPE_WATER) {                         // this is water
                                                                           //   wall[TYPE] = wallX0Yp[TYPE];                                     // land can't be over water. copy walltype from above
          base[TEMPERATURE] = texture(baseTex, texCoordX0Yp)[TEMPERATURE]; // copy water temperature from above
        }
      }

    } else if (wall[VERT_DISTANCE] == 0) { // at/in surface layer

      switch (wall[TYPE]) {
      case WALLTYPE_URBAN:
        wall[VEGETATION] = min(wall[VEGETATION], 75);                                            // limit vegetation in urban areas
      case WALLTYPE_LAND:
        water[SOIL_MOISTURE] = clamp(water[SOIL_MOISTURE] + precipFeedback[VAPOR], 0.0, 100.0);  // rain accumulation
        water[SNOW] = clamp(water[SNOW] + precipFeedback[SNOW] * snowMassToHeight, 0.0, 4000.0); // snow accumulation in cm

        if (int(iterNum) % 700 == 0) {                                                           // fire and snow spread at fixed rate

          // average out snow cover
          float numNeighbors = 0.;
          float totalNeighborSnow = 0.0;

          if (wallXmY0[VERT_DISTANCE] == 0 && (wallXmY0[TYPE] == WALLTYPE_LAND || wallXmY0[TYPE] == WALLTYPE_URBAN)) {
            totalNeighborSnow += texture(waterTex, texCoordXmY0)[SNOW];
            numNeighbors += 1.;
          }
          if (wallXpY0[VERT_DISTANCE] == 0 && (wallXpY0[TYPE] == WALLTYPE_LAND || wallXpY0[TYPE] == WALLTYPE_URBAN)) {
            totalNeighborSnow += texture(waterTex, texCoordXpY0)[SNOW];
            numNeighbors += 1.;
          }
          if (numNeighbors > 0.) { // prevent devide by 0
            float avgNeighborSnow = totalNeighborSnow / numNeighbors;
            water[SNOW] += (avgNeighborSnow - water[SNOW]) * 0.1;
          }


          if (wall[VEGETATION] >= minimalFireVegitation && (wallXmY0[TYPE] == WALLTYPE_FIRE || wallXpY0[TYPE] == WALLTYPE_FIRE || texture(waterTex, texCoordX0Yp)[SMOKE] > 3.5)) // if left or right is on fire or fire is blowing over
            wall[TYPE] = WALLTYPE_FIRE;                                                                                                                                          // spread fire
        }
        break;
      case WALLTYPE_WATER:
        // average out temperature
        float numNeighbors = 0.;
        float totalNeighborTemp = 0.0;

        if (wallXmY0[TYPE] == WALLTYPE_WATER) { // left is water
          totalNeighborTemp += texture(baseTex, texCoordXmY0)[TEMPERATURE];
          numNeighbors += 1.;
        }
        if (wallXpY0[TYPE] == WALLTYPE_WATER) { // right is water
          totalNeighborTemp += texture(baseTex, texCoordXpY0)[TEMPERATURE];
          numNeighbors += 1.;
        }
        if (numNeighbors > 0.) { // prevent devide by 0
          float avgNeighborTemp = totalNeighborTemp / numNeighbors;
          base[TEMPERATURE] += (avgNeighborTemp - base[TEMPERATURE]) * 0.25;
        }
        if (base[TEMPERATURE] > 500.0) { // set water temperature for older savefiles
          base[TEMPERATURE] = CtoK(25.0);
        }
        base[TEMPERATURE] = clamp(base[TEMPERATURE], CtoK(0.0), CtoK(maxWaterTemp)); // limit water temperature range
        break;
      case WALLTYPE_FIRE:
        if (int(iterNum) % 300 == 0) {
          wall[VEGETATION] -= 1;        // reduce vegetation
          if (wall[VEGETATION] < minimalFireVegitation)
            wall[TYPE] = WALLTYPE_LAND; // turn off fire
        }
      }
    }
  }
} // main