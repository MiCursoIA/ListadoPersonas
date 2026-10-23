// test01.js - Test de carga escalonado para determinar punto de degradación
// Endpoint: GET https://cursotesting.com.ar:3000/personas/listado
// Objetivo: Encontrar capacidad máxima y punto de degradación del servicio

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============================================
// CONFIGURACIÓN DE MÉTRICAS PERSONALIZADAS
// ============================================

// Métrica para trackear tasa de error (error rate)
export const errorRate = new Rate('error_rate');

// Métrica para trackear tiempo de respuesta (latencia)
export const responseTime = new Trend('response_time');

// ============================================
// CONFIGURACIÓN DEL TEST (OPTIONS)
// ============================================

export const options = {
  // Definición de etapas (stages) - Rampa escalonada de usuarios concurrentes
  // Cada etapa dura 5 minutos (300 segundos)
  stages: [
    { target: 50, duration: '5m' },   // Etapa 1: 50 usuarios concurrentes
    { target: 100, duration: '5m' },  // Etapa 2: 100 usuarios concurrentes
    { target: 200, duration: '5m' },  // Etapa 3: 200 usuarios concurrentes
    { target: 400, duration: '5m' },  // Etapa 4: 400 usuarios concurrentes
    { target: 800, duration: '5m' },  // Etapa 5: 800 usuarios concurrentes
  ],

  // Umbrales de falla (thresholds) - El test falla si se superan
  thresholds: {
    // P95 del tiempo de respuesta no debe superar 3 segundos
    'http_req_duration{expected_response:true}': ['p(95)<3000'],
    // Tasa de error no debe superar 5%
    'error_rate': ['rate<0.05'],
    // Nota: CPU del servidor no se puede medir directamente desde k6
    // Se recomienda monitorear CPU en el servidor con herramientas APM (Datadog, New Relic, Prometheus/Grafana, etc.)
  },

  // Configuración adicional
  // Deshabilitar keep-alive para simular conexiones nuevas cada request (más realista para API REST)
  noConnectionReuse: false,
  // Tiempo de espera para establecer conexión TCP
  // timeout: '60s',
};

// ============================================
// FUNCIÓN PRINCIPAL (DEFAULT FUNCTION)
// Se ejecuta por cada usuario virtual (VU) en cada iteración
// ============================================

export default function () {
  // URL del endpoint a probar
  const url = 'https://cursotesting.com.ar:3000/personas/listado';

  // Headers HTTP - Simular un cliente real (navegador/app)
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'k6-load-test/1.0',
    },
    // Timeout para la request (30 segundos)
    timeout: '30s',
    // Tags para filtrar métricas en resultados
    tags: {
      name: 'ListadoPersonas',
      endpoint: '/personas/listado',
    },
  };

  // ============================================
  // EJECUCIÓN DE LA PETICIÓN HTTP GET
  // ============================================
  const startTime = new Date(); // Timestamp inicio para cálculo manual si se necesita
  const response = http.get(url, params);
  const endTime = new Date();   // Timestamp fin

  // ============================================
  // VALIDACIONES (CHECKS) - Assertions del test
  // ============================================

  // Check 1: Verificar que el status code sea 200 (OK)
  const statusOk = check(response, {
    'Status es 200': (r) => r.status === 200,
  });

  // Check 2: Verificar que el body no esté vacío
  const bodyNotEmpty = check(response, {
    'Body no vacío': (r) => r.body && r.body.length > 0,
  });

  // Check 3: Verificar que el Content-Type sea JSON
  const contentTypeJson = check(response, {
    'Content-Type es JSON': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json'),
  });

  // Check 4: Verificar tiempo de respuesta < 3000ms (3 segundos) - Para P95
  const responseTimeOk = check(response, {
    'Tiempo respuesta < 3s': (r) => r.timings.duration < 3000,
  });

  // ============================================
  // REGISTRO DE MÉTRICAS PERSONALIZADAS
  // ============================================

  // Registrar error rate: 1 si falla, 0 si pasa
  // Se considera error si status != 200 O si tiempo > 3s
  const isError = response.status !== 200 || response.timings.duration >= 3000;
  errorRate.add(isError);

  // Registrar tiempo de respuesta en métrica personalizada
  responseTime.add(response.timings.duration);

  // ============================================
  // LOGGING DE RESULTADOS (Opcional - para debug)
  // ============================================

  // Log solo si hay error o respuesta lenta (para no saturar output)
  if (isError || response.timings.duration > 1000) {
    console.log(`VU=${__VU} ITER=${__ITER} | Status=${response.status} | Duración=${response.timings.duration.toFixed(2)}ms | URL=${url}`);
  }

  // ============================================
  // SLEEP - Pausa entre iteraciones (Think time)
  // ============================================
  // Simula tiempo de "pensamiento" del usuario real
  // 1 segundo entre requests para no saturar el servidor instantáneamente
  sleep(1);
}

// ============================================
// FUNCIÓN TEARDOWN (Opcional)
// Se ejecuta una sola vez al final del test
// ============================================

export function teardown(data) {
  console.log('=== TEST FINALIZADO ===');
  console.log('Revisar resultados:');
  console.log('- P95 http_req_duration: Debe ser < 3000ms');
  console.log('- error_rate: Debe ser < 0.05 (5%)');
  console.log('- Monitorear CPU del servidor externamente (APM/Monitoring)');
  console.log('Punto de degradación = Primera etapa donde se rompen umbrales');
}

// ============================================
// INSTRUCCIONES DE EJECUCIÓN:
// ============================================
// k6 run test01.js
//
// Para salida a InfluxDB + Grafana:
// k6 run --out influxdb=http://localhost:8086/k6 test01.js
//
// Para salida JSON (análisis posterior):
// k6 run --out json=resultados.json test01.js
//
// Para ver resumen en consola al finalizar:
// k6 run --summary-export=resumen.json test01.js