import { Observable, ObservableInput, switchMap, throwError as observableThrowError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { AuthRepository } from '~modules/auth/store/auth.repository';
import { AppConfig } from '../../../configs/app.config';
import jwt_decode from 'jwt-decode';
import { AuthService } from '~modules/auth/shared/auth.service';
import { authRoutes } from '~modules/auth/shared/auth-routes';
import { Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { AlertId } from '~modules/shared/services/alert.service';

export class TokenInterceptor implements HttpInterceptor {
  window: Window;

  // eslint-disable-next-line max-params
  constructor(
    private router: Router,
    private authService: AuthService,
    private authRepository: AuthRepository,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.window = this.document.defaultView as Window;
  }

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const headers = { req_uuid: (Date.now() + Math.random()).toString(), Authorization: '' };
    const accessToken = this.authRepository.getAccessTokenValue();
    const refreshToken = this.authRepository.getRefreshTokenValue();
    if (accessToken && refreshToken && !request.headers.get(AppConfig.bypassAuthorization)) {
      const { isAccessTokenExpired, isRefreshTokenExpired } = this.getTokenExpirations(
        accessToken,
        refreshToken
      );

      if (isAccessTokenExpired) {
        if (!isRefreshTokenExpired) {
          return this.updateExpiredToken(request, next, headers);
        } else {
          this.navigateToLogout();
          return observableThrowError(() => new Error());
        }
      } else {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
    }

    return this.sendRequest(request, next, headers);
  }

  getTokenExpirations(accessToken: string, refreshToken: string) {
    const accessTokenValue: { exp: number } = jwt_decode(accessToken);
    const isAccessTokenExpired = Date.now() >= accessTokenValue.exp * 1000;

    const refreshTokenValue: { exp: number } = jwt_decode(refreshToken);
    const isRefreshTokenExpired = Date.now() >= refreshTokenValue.exp * 1000;

    return { isAccessTokenExpired, isRefreshTokenExpired };
  }

  checkUnAuthorizedError(response: unknown) {
    if (response instanceof HttpResponse) {
      const bodyErrors = response.body.errors;
      if (bodyErrors?.length) {
        const unAuthorizeErrorFounded = bodyErrors.find(
          (bodyError: { code: number }) => bodyError.code === 401
        );
        if (unAuthorizeErrorFounded) {
          this.navigateToLogout();
        }
      }
    }
  }

  sendRequest(
    request: HttpRequest<unknown>,
    next: HttpHandler,
    headers: { req_uuid: string; Authorization: string }
  ) {
    const newRequest = request.clone({ setHeaders: headers });
    return next.handle(newRequest).pipe(
      map(response => {
        this.checkUnAuthorizedError(response);
        return response;
      }),
      catchError(err => observableThrowError(err))
    );
  }

  updateExpiredToken(
    request: HttpRequest<unknown>,
    next: HttpHandler,
    headers: { req_uuid: string; Authorization: string }
  ) {
    return this.authService.refreshToken().pipe(
      switchMap(() => {
        const token = this.authRepository.getAccessTokenValue();
        headers['Authorization'] = `Bearer ${token}`;
        const updateTokenRequest = request.clone({
          setHeaders: headers,
        });
        return next.handle(updateTokenRequest).pipe(catchError(err => observableThrowError(err)));
      }),
      catchError((error): ObservableInput<HttpEvent<unknown>> => {
        this.navigateToLogout();
        return observableThrowError(error);
      })
    );
  }

  navigateToLogout() {
    this.router.navigate([authRoutes.logout], {
      queryParams: {
        origin: encodeURIComponent(this.window.location.href),
        alertId: AlertId.SESSION_EXPIRED,
      },
    });
  }
}
